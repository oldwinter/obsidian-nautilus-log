export const PLUGIN_DATA_SCHEMA_VERSION = 1 as const;

export type PluginLanguage = "en" | "zh";

export function pluginLanguageFromHost(locale: string): PluginLanguage {
  const normalized = locale.trim().replaceAll("_", "-").toLowerCase();
  return normalized === "zh" || normalized.startsWith("zh-cn") || normalized.startsWith("zh-hans")
    ? "zh"
    : "en";
}

export interface PluginSettings {
  readonly language: PluginLanguage;
  readonly chartStartHour: 5 | 6 | 7 | 8;
  readonly chartEndHour: 18 | 19 | 20 | 21 | 22 | 23 | 24;
  readonly componentPrefix: string;
  readonly legendMaxLength: 14 | 16 | 18 | 20 | 22 | 24 | 26 | 28;
  readonly defaultDurationMinutes: 5 | 10 | 15 | 20 | 25 | 30 | 45 | 60;
  readonly urgentTrigger: string;
  readonly executionEnabled: boolean;
  readonly keepTimingFirst: boolean;
  readonly pomoThresholdMinutes: 15 | 20 | 25 | 30 | 45 | 50 | 60 | 90;
  readonly recentRetentionMinutes: number;
  readonly forgottenWarningMinutes: number;
  readonly dailyNoteFolder: string;
  readonly dailyNoteFormat: string;
}

export interface PluginDataDocument {
  readonly schemaVersion: typeof PLUGIN_DATA_SCHEMA_VERSION;
  readonly settings: PluginSettings;
  readonly taskPomoStartEpochMs: number | null;
  readonly standalonePomoStartEpochMs: number | null;
}

export type PluginDataDiagnosticCode = "field-repaired" | "field-ignored";

export interface PluginDataDiagnostic {
  readonly code: PluginDataDiagnosticCode;
  readonly path: string;
  readonly reason: "missing" | "invalid" | "normalized" | "unknown" | "unsupported-schema";
}

export interface PluginDataValidation {
  readonly data: PluginDataDocument;
  readonly diagnostics: readonly PluginDataDiagnostic[];
}

export interface PluginDataSnapshot extends PluginDataValidation {
  readonly revision: number;
}

export interface PluginDataPort {
  load(): Promise<unknown>;
  save(data: PluginDataDocument): Promise<void>;
}

export type PluginDataUpdater = (current: PluginDataDocument) => PluginDataDocument;

const CHART_START_HOURS = Object.freeze([5, 6, 7, 8] as const);
const CHART_END_HOURS = Object.freeze([18, 19, 20, 21, 22, 23, 24] as const);
const LEGEND_MAX_LENGTHS = Object.freeze([14, 16, 18, 20, 22, 24, 26, 28] as const);
const DEFAULT_DURATIONS = Object.freeze([5, 10, 15, 20, 25, 30, 45, 60] as const);
const POMO_THRESHOLDS = Object.freeze([15, 20, 25, 30, 45, 50, 60, 90] as const);
const MAX_DATE_EPOCH_MS = 8_640_000_000_000_000;

export const DEFAULT_PLUGIN_SETTINGS: Readonly<PluginSettings> = Object.freeze({
  language: "en",
  chartStartHour: 5,
  chartEndHour: 21,
  componentPrefix: "[[Nautilus Log]]",
  legendMaxLength: 22,
  defaultDurationMinutes: 15,
  urgentTrigger: "",
  executionEnabled: false,
  keepTimingFirst: true,
  pomoThresholdMinutes: 45,
  recentRetentionMinutes: 45,
  forgottenWarningMinutes: 120,
  dailyNoteFolder: "",
  dailyNoteFormat: "YYYY-MM-DD",
});

export const DEFAULT_PLUGIN_DATA: Readonly<PluginDataDocument> = Object.freeze({
  schemaVersion: PLUGIN_DATA_SCHEMA_VERSION,
  settings: DEFAULT_PLUGIN_SETTINGS,
  taskPomoStartEpochMs: null,
  standalonePomoStartEpochMs: null,
});

const DATA_FIELDS = new Set([
  "schemaVersion",
  "settings",
  "taskPomoStartEpochMs",
  "standalonePomoStartEpochMs",
]);
const SETTINGS_FIELDS = new Set(Object.keys(DEFAULT_PLUGIN_SETTINGS));

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function diagnostic(
  code: PluginDataDiagnosticCode,
  path: string,
  reason: PluginDataDiagnostic["reason"],
): PluginDataDiagnostic {
  return Object.freeze({ code, path, reason });
}

function addUnknownFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  prefix: string,
  diagnostics: PluginDataDiagnostic[],
): void {
  for (const key of Object.keys(value).sort()) {
    if (!allowed.has(key)) {
      diagnostics.push(diagnostic("field-ignored", prefix ? `${prefix}.${key}` : key, "unknown"));
    }
  }
}

function acceptedChoice<T extends number>(
  value: unknown,
  choices: readonly T[],
): value is T {
  return typeof value === "number" && choices.some((choice) => choice === value);
}

function repaired<T>(
  value: unknown,
  fallback: T,
  path: string,
  diagnostics: PluginDataDiagnostic[],
  accept: (candidate: unknown) => candidate is T,
): T {
  if (value === undefined) {
    diagnostics.push(diagnostic("field-repaired", path, "missing"));
    return fallback;
  }
  if (!accept(value)) {
    diagnostics.push(diagnostic("field-repaired", path, "invalid"));
    return fallback;
  }
  return value;
}

function normalizeFolder(value: string): string | undefined {
  if (value.includes("\0")) return undefined;
  const slashFolder = value.replaceAll("\\", "/");
  if (slashFolder.startsWith("/") || /^[A-Za-z]:\//.test(slashFolder)) return undefined;
  const segments: string[] = [];
  for (const segment of slashFolder.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === ".." || /[<>:"|?*\u0000-\u001f]/.test(segment)) return undefined;
    segments.push(segment);
  }
  return segments.join("/");
}

function validDailyNoteFormat(value: string): boolean {
  if (value.length === 0 || value !== value.trim() || value.includes("\\")) return false;

  const components = new Set<"year" | "month" | "day">();
  const parts: Array<{ readonly variable: boolean } | { readonly literal: string }> = [];
  const renderedParts: string[] = [];
  for (let offset = 0; offset < value.length;) {
    if (value[offset] === "[") {
      const close = value.indexOf("]", offset + 1);
      if (close < 0 || close === offset + 1) return false;
      const literal = value.slice(offset + 1, close);
      parts.push({ literal });
      renderedParts.push(literal);
      offset = close + 1;
      continue;
    }
    if (value[offset] === "]") return false;

    const token = (["YYYY", "MM", "DD", "M", "D"] as const)
      .find((candidate) => value.startsWith(candidate, offset));
    if (token) {
      const component = token === "YYYY" ? "year" : token.startsWith("M") ? "month" : "day";
      components.add(component);
      parts.push({ variable: token.length === 1 });
      renderedParts.push(component === "year" ? "2026" : component === "month" ? "08" : "28");
      offset += token.length;
      continue;
    }
    if (/[A-Za-z]/.test(value[offset]!)) return false;
    const previous = parts[parts.length - 1];
    if (previous && "literal" in previous) {
      parts[parts.length - 1] = { literal: previous.literal + value[offset]! };
    } else {
      parts.push({ literal: value[offset]! });
    }
    renderedParts.push(value[offset]!);
    offset += 1;
  }

  if (!["year", "month", "day"].every((component) => components.has(component as "year" | "month" | "day"))) {
    return false;
  }
  for (const [index, part] of parts.entries()) {
    if (!("variable" in part) || !part.variable) continue;
    const previous = parts[index - 1];
    const next = parts[index + 1];
    if (
      (previous && "variable" in previous)
      || (next && "variable" in next)
      || (previous && "literal" in previous && /[0-9]$/.test(previous.literal))
      || (next && "literal" in next && /^[0-9]/.test(next.literal))
    ) return false;
  }
  const rendered = renderedParts.join("");
  if (
    rendered.startsWith("/")
    || rendered.endsWith("/")
    || rendered.includes("//")
    || rendered.toLowerCase().endsWith(".md")
    || /[<>:"|?*\u0000-\u001f]/.test(rendered)
    || rendered.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) return false;
  return true;
}

function validateSettings(
  value: unknown,
  diagnostics: PluginDataDiagnostic[],
): PluginSettings {
  const settings = isRecord(value) ? value : {};
  if (!isRecord(value)) {
    diagnostics.push(diagnostic("field-repaired", "settings", value === undefined ? "missing" : "invalid"));
  } else {
    addUnknownFields(settings, SETTINGS_FIELDS, "settings", diagnostics);
  }

  const rawFolder = settings.dailyNoteFolder;
  const normalizedFolder = typeof rawFolder === "string" ? normalizeFolder(rawFolder) : undefined;
  let dailyNoteFolder = DEFAULT_PLUGIN_SETTINGS.dailyNoteFolder;
  if (rawFolder === undefined) {
    diagnostics.push(diagnostic("field-repaired", "settings.dailyNoteFolder", "missing"));
  } else if (normalizedFolder === undefined) {
    diagnostics.push(diagnostic("field-repaired", "settings.dailyNoteFolder", "invalid"));
  } else {
    dailyNoteFolder = normalizedFolder;
    if (normalizedFolder !== rawFolder) {
      diagnostics.push(diagnostic("field-repaired", "settings.dailyNoteFolder", "normalized"));
    }
  }

  const rawUrgentTrigger = settings.urgentTrigger;
  let urgentTrigger = DEFAULT_PLUGIN_SETTINGS.urgentTrigger;
  if (rawUrgentTrigger === undefined) {
    diagnostics.push(diagnostic("field-repaired", "settings.urgentTrigger", "missing"));
  } else if (typeof rawUrgentTrigger !== "string") {
    diagnostics.push(diagnostic("field-repaired", "settings.urgentTrigger", "invalid"));
  } else {
    urgentTrigger = rawUrgentTrigger.replace(/\s/gu, "");
    if (urgentTrigger !== rawUrgentTrigger) {
      diagnostics.push(diagnostic("field-repaired", "settings.urgentTrigger", "normalized"));
    }
  }

  return Object.freeze({
    language: repaired(
      settings.language,
      DEFAULT_PLUGIN_SETTINGS.language,
      "settings.language",
      diagnostics,
      (candidate): candidate is PluginLanguage => candidate === "en" || candidate === "zh",
    ),
    chartStartHour: repaired(
      settings.chartStartHour,
      DEFAULT_PLUGIN_SETTINGS.chartStartHour,
      "settings.chartStartHour",
      diagnostics,
      (candidate): candidate is PluginSettings["chartStartHour"] => acceptedChoice(candidate, CHART_START_HOURS),
    ),
    chartEndHour: repaired(
      settings.chartEndHour,
      DEFAULT_PLUGIN_SETTINGS.chartEndHour,
      "settings.chartEndHour",
      diagnostics,
      (candidate): candidate is PluginSettings["chartEndHour"] => acceptedChoice(candidate, CHART_END_HOURS),
    ),
    componentPrefix: repaired(
      settings.componentPrefix,
      DEFAULT_PLUGIN_SETTINGS.componentPrefix,
      "settings.componentPrefix",
      diagnostics,
      (candidate): candidate is string => typeof candidate === "string",
    ),
    legendMaxLength: repaired(
      settings.legendMaxLength,
      DEFAULT_PLUGIN_SETTINGS.legendMaxLength,
      "settings.legendMaxLength",
      diagnostics,
      (candidate): candidate is PluginSettings["legendMaxLength"] => acceptedChoice(candidate, LEGEND_MAX_LENGTHS),
    ),
    defaultDurationMinutes: repaired(
      settings.defaultDurationMinutes,
      DEFAULT_PLUGIN_SETTINGS.defaultDurationMinutes,
      "settings.defaultDurationMinutes",
      diagnostics,
      (candidate): candidate is PluginSettings["defaultDurationMinutes"] => acceptedChoice(candidate, DEFAULT_DURATIONS),
    ),
    urgentTrigger,
    executionEnabled: repaired(
      settings.executionEnabled,
      DEFAULT_PLUGIN_SETTINGS.executionEnabled,
      "settings.executionEnabled",
      diagnostics,
      (candidate): candidate is boolean => typeof candidate === "boolean",
    ),
    keepTimingFirst: repaired(
      settings.keepTimingFirst,
      DEFAULT_PLUGIN_SETTINGS.keepTimingFirst,
      "settings.keepTimingFirst",
      diagnostics,
      (candidate): candidate is boolean => typeof candidate === "boolean",
    ),
    pomoThresholdMinutes: repaired(
      settings.pomoThresholdMinutes,
      DEFAULT_PLUGIN_SETTINGS.pomoThresholdMinutes,
      "settings.pomoThresholdMinutes",
      diagnostics,
      (candidate): candidate is PluginSettings["pomoThresholdMinutes"] => acceptedChoice(candidate, POMO_THRESHOLDS),
    ),
    recentRetentionMinutes: repaired(
      settings.recentRetentionMinutes,
      DEFAULT_PLUGIN_SETTINGS.recentRetentionMinutes,
      "settings.recentRetentionMinutes",
      diagnostics,
      (candidate): candidate is number => typeof candidate === "number"
        && Number.isSafeInteger(candidate)
        && candidate >= 0,
    ),
    forgottenWarningMinutes: repaired(
      settings.forgottenWarningMinutes,
      DEFAULT_PLUGIN_SETTINGS.forgottenWarningMinutes,
      "settings.forgottenWarningMinutes",
      diagnostics,
      (candidate): candidate is number => typeof candidate === "number"
        && Number.isSafeInteger(candidate)
        && candidate >= 0,
    ),
    dailyNoteFolder,
    dailyNoteFormat: repaired(
      settings.dailyNoteFormat,
      DEFAULT_PLUGIN_SETTINGS.dailyNoteFormat,
      "settings.dailyNoteFormat",
      diagnostics,
      (candidate): candidate is string => typeof candidate === "string" && validDailyNoteFormat(candidate),
    ),
  });
}

function validEpochMilliseconds(value: unknown): value is number | null {
  return value === null
    || (typeof value === "number"
      && Number.isSafeInteger(value)
      && value >= 0
      && value <= MAX_DATE_EPOCH_MS);
}

function freezeData(
  settings: PluginSettings,
  taskPomoStartEpochMs: number | null,
  standalonePomoStartEpochMs: number | null,
): PluginDataDocument {
  return Object.freeze({
    schemaVersion: PLUGIN_DATA_SCHEMA_VERSION,
    settings,
    taskPomoStartEpochMs,
    standalonePomoStartEpochMs,
  });
}

function freezeValidation(
  data: PluginDataDocument,
  diagnostics: PluginDataDiagnostic[],
): PluginDataValidation {
  return Object.freeze({ data, diagnostics: Object.freeze(diagnostics) });
}

export function validatePluginData(
  value: unknown,
  options?: { readonly hostLanguage?: string },
): PluginDataValidation {
  if (value === undefined || value === null) {
    const language = options?.hostLanguage === undefined
      ? DEFAULT_PLUGIN_SETTINGS.language
      : pluginLanguageFromHost(options.hostLanguage);
    if (language === DEFAULT_PLUGIN_SETTINGS.language) {
      return freezeValidation(DEFAULT_PLUGIN_DATA, []);
    }
    return freezeValidation(freezeData({ ...DEFAULT_PLUGIN_SETTINGS, language }, null, null), []);
  }
  if (!isRecord(value)) {
    return freezeValidation(
      DEFAULT_PLUGIN_DATA,
      [diagnostic("field-repaired", "$", "invalid")],
    );
  }

  const diagnostics: PluginDataDiagnostic[] = [];
  addUnknownFields(value, DATA_FIELDS, "", diagnostics);
  if (value.schemaVersion !== PLUGIN_DATA_SCHEMA_VERSION) {
    diagnostics.push(diagnostic(
      "field-repaired",
      "schemaVersion",
      value.schemaVersion === undefined ? "missing" : "unsupported-schema",
    ));
    return freezeValidation(DEFAULT_PLUGIN_DATA, diagnostics);
  }

  const settings = validateSettings(value.settings, diagnostics);
  const taskPomoStartEpochMs = repaired(
    value.taskPomoStartEpochMs,
    null,
    "taskPomoStartEpochMs",
    diagnostics,
    validEpochMilliseconds,
  );
  const standalonePomoStartEpochMs = repaired(
    value.standalonePomoStartEpochMs,
    null,
    "standalonePomoStartEpochMs",
    diagnostics,
    validEpochMilliseconds,
  );
  return freezeValidation(
    freezeData(settings, taskPomoStartEpochMs, standalonePomoStartEpochMs),
    diagnostics,
  );
}

function cloneData(data: PluginDataDocument): PluginDataDocument {
  return {
    schemaVersion: PLUGIN_DATA_SCHEMA_VERSION,
    settings: { ...data.settings },
    taskPomoStartEpochMs: data.taskPomoStartEpochMs,
    standalonePomoStartEpochMs: data.standalonePomoStartEpochMs,
  };
}

function sameData(left: PluginDataDocument, right: PluginDataDocument): boolean {
  if (
    left.schemaVersion !== right.schemaVersion
    || left.taskPomoStartEpochMs !== right.taskPomoStartEpochMs
    || left.standalonePomoStartEpochMs !== right.standalonePomoStartEpochMs
  ) return false;
  for (const key of SETTINGS_FIELDS) {
    const setting = key as keyof PluginSettings;
    if (left.settings[setting] !== right.settings[setting]) return false;
  }
  return true;
}

function snapshot(
  revision: number,
  validation: PluginDataValidation,
): PluginDataSnapshot {
  return Object.freeze({
    revision,
    data: validation.data,
    diagnostics: validation.diagnostics,
  });
}

export class PluginDataStoppedError extends Error {
  constructor() {
    super("Plugin data store is stopped");
    this.name = "PluginDataStoppedError";
  }
}

export class PluginDataReadbackError extends Error {
  constructor() {
    super("Saved plugin data could not be confirmed by read-back");
    this.name = "PluginDataReadbackError";
  }
}

export class PluginDataStore {
  readonly #port: PluginDataPort;
  readonly #hostLanguage: string | undefined;
  #snapshot = snapshot(0, freezeValidation(DEFAULT_PLUGIN_DATA, []));
  #loaded = false;
  #loading: Promise<PluginDataSnapshot> | undefined;
  #tail: Promise<void> = Promise.resolve();
  #stopped = false;
  #stopPromise: Promise<void> | undefined;

  constructor(port: PluginDataPort, options?: { readonly hostLanguage?: string }) {
    this.#port = port;
    this.#hostLanguage = options?.hostLanguage;
  }

  get snapshot(): PluginDataSnapshot {
    return this.#snapshot;
  }

  get data(): PluginDataDocument {
    return this.#snapshot.data;
  }

  get revision(): number {
    return this.#snapshot.revision;
  }

  load(): Promise<PluginDataSnapshot> {
    if (this.#stopped) return Promise.reject(new PluginDataStoppedError());
    if (this.#loaded) return Promise.resolve(this.#snapshot);
    if (this.#loading) return this.#loading;

    const operation = this.#tail.then(async () => {
      const validation = validatePluginData(
        await this.#port.load(),
        this.#hostLanguage === undefined ? undefined : { hostLanguage: this.#hostLanguage },
      );
      if (this.#stopped) throw new PluginDataStoppedError();
      this.#snapshot = snapshot(this.#snapshot.revision + 1, validation);
      this.#loaded = true;
      return this.#snapshot;
    });
    this.#loading = operation;
    this.#tail = operation.then(
      () => undefined,
      () => undefined,
    );
    void operation.finally(() => {
      this.#loading = undefined;
    }).catch(() => undefined);
    return operation;
  }

  update(updater: PluginDataUpdater): Promise<PluginDataSnapshot> {
    if (this.#stopped) return Promise.reject(new PluginDataStoppedError());
    if (!this.#loaded) {
      return Promise.reject(new Error("Plugin data must be loaded before it is updated"));
    }

    const operation = this.#tail.then(async () => {
      const validation = validatePluginData(updater(this.#snapshot.data));
      await this.#port.save(validation.data);
      const confirmed = validatePluginData(await this.#port.load());
      if (!sameData(validation.data, confirmed.data) || confirmed.diagnostics.length > 0) {
        throw new PluginDataReadbackError();
      }
      if (this.#stopped) throw new PluginDataStoppedError();
      this.#snapshot = snapshot(this.#snapshot.revision + 1, validation);
      return this.#snapshot;
    });
    this.#tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  stop(): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise;
    this.#stopped = true;
    this.#stopPromise = this.#tail;
    return this.#stopPromise;
  }
}

export class InMemoryPluginDataPort implements PluginDataPort {
  #data: unknown;
  #saveCount = 0;

  constructor(initialData?: unknown) {
    this.#data = initialData === undefined ? undefined : structuredClone(initialData);
  }

  get saveCount(): number {
    return this.#saveCount;
  }

  async load(): Promise<unknown> {
    return this.#data === undefined ? undefined : structuredClone(this.#data);
  }

  async save(data: PluginDataDocument): Promise<void> {
    this.#data = cloneData(data);
    this.#saveCount += 1;
  }
}
