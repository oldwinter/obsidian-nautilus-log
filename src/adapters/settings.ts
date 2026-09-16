import {
  Notice,
  PluginSettingTab,
  Setting,
  type App,
  type Plugin,
  type SettingDefinitionItem,
} from "obsidian";
import {
  ignoredHostDailyNoteFormat,
  interpretDailyNoteSetting,
  type DailyNoteSettingField,
} from "./daily-note-setting";
import { renderEmptyPlanGuidance, renderPlanMissingGuidance } from "../ui/onboarding/first-run";
import type { HostDailyNoteSeed, PluginSettings } from "../runtime/plugin-data";
import type { RuntimePlanProjection } from "../runtime/projection-runtime";
import type { RuntimeSnapshot } from "../runtime/snapshots";
import { settingsOnboardingKind } from "./settings-onboarding";
import type { ExecutionCatalog } from "../i18n/locales/en/execution";
import type { ExecutionMessages } from "../ui/execution/shared-controls";

export interface ExecutionSettingsDependencies {
  readonly app: App;
  readonly plugin: Plugin;
  readonly messages: ExecutionMessages;
  readonly settings: () => PluginSettings;
  readonly update: (patch: Partial<PluginSettings>) => Promise<void>;
  readonly setExecutionEnabled: (enabled: boolean) => Promise<boolean>;
  readonly onLocaleChanged: () => void;
  readonly onExecutionChanged: (enabled: boolean) => void;
  readonly insertPrimaryPlan?: () => void | Promise<void>;
  readonly planSnapshot?: () => RuntimeSnapshot<RuntimePlanProjection> | undefined;
  readonly hostDailyNote?: () => HostDailyNoteSeed | undefined;
  readonly onError?: (error: unknown) => void;
}

const CHART_START = [5, 6, 7, 8] as const;
const CHART_END = [18, 19, 20, 21, 22, 23, 24] as const;
const LEGEND_LENGTH = [14, 16, 18, 20, 22, 24, 26, 28] as const;
const DEFAULT_DURATION = [5, 10, 15, 20, 25, 30, 45, 60] as const;
const POMO_THRESHOLD = [15, 20, 25, 30, 45, 50, 60, 90] as const;
type SettingsMessageKey = Extract<keyof ExecutionCatalog, `settings.${string}`>;

function choices(values: readonly number[]): Record<string, string> {
  return Object.fromEntries(values.map((value) => [String(value), String(value)]));
}

function numericMinutes(value: string, fallback: number): number | undefined {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback;
}

export class SpiralDaySettingTab extends PluginSettingTab {
  readonly #dependencies: ExecutionSettingsDependencies;
  #displayGeneration = 0;

  constructor(dependencies: ExecutionSettingsDependencies) {
    super(dependencies.app, dependencies.plugin);
    this.#dependencies = dependencies;
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    return [];
  }

  override display(): void {
    const generation = ++this.#displayGeneration;
    const { containerEl } = this;
    containerEl.replaceChildren();
    const heading = containerEl.ownerDocument.createElement("h2");
    heading.textContent = this.#dependencies.messages.t("execution", "settings.title");
    containerEl.append(heading);
    this.#appendOnboarding(containerEl);
    const current = this.#dependencies.settings();

    new Setting(containerEl)
      .setName(this.#dependencies.messages.t("execution", "settings.language"))
      .addDropdown((dropdown) => dropdown
        .addOptions({ en: "English", zh: "简体中文" })
        .setValue(current.language)
        .onChange((value) => this.#run(generation, async () => {
          await this.#dependencies.update({ language: value === "zh" ? "zh" : "en" });
          this.#dependencies.messages.setLocale(value);
          this.#dependencies.onLocaleChanged();
          this.display();
        })));

    this.#select(containerEl, "settings.chartStart", current.chartStartHour, CHART_START,
      (value) => ({ chartStartHour: value }));
    this.#select(containerEl, "settings.chartEnd", current.chartEndHour, CHART_END,
      (value) => ({ chartEndHour: value }));
    this.#text(containerEl, "settings.componentPrefix", current.componentPrefix,
      (value) => ({ componentPrefix: value }), "settings.componentPrefixDesc");
    this.#select(containerEl, "settings.legendLength", current.legendMaxLength, LEGEND_LENGTH,
      (value) => ({ legendMaxLength: value }));
    this.#select(containerEl, "settings.defaultDuration", current.defaultDurationMinutes, DEFAULT_DURATION,
      (value) => ({ defaultDurationMinutes: value }));
    this.#text(containerEl, "settings.urgentTrigger", current.urgentTrigger,
      (value) => ({ urgentTrigger: value.replace(/\s/gu, "") }));

    new Setting(containerEl)
      .setName(this.#dependencies.messages.t("execution", "settings.executionEnabled"))
      .setDesc(this.#dependencies.messages.t("execution", "settings.executionEnabledDesc"))
      .addToggle((toggle) => toggle
        .setValue(current.executionEnabled)
        .onChange((enabled) => {
          toggle.setDisabled(true);
          this.#run(generation, async () => {
            const accepted = await this.#dependencies.setExecutionEnabled(enabled);
            toggle.setValue(accepted ? enabled : !enabled);
            this.#dependencies.onExecutionChanged(accepted ? enabled : !enabled);
            this.display();
          });
        }));

    if (current.executionEnabled) {
      new Setting(containerEl)
        .setName(this.#dependencies.messages.t("execution", "settings.keepTimingFirst"))
        .addToggle((toggle) => toggle
          .setValue(current.keepTimingFirst)
          .onChange((value) => this.#run(generation, () => this.#dependencies.update({ keepTimingFirst: value }))));
      this.#select(containerEl, "settings.pomoThreshold", current.pomoThresholdMinutes, POMO_THRESHOLD,
        (value) => ({ pomoThresholdMinutes: value }));
      this.#numeric(containerEl, "settings.recentRetention", current.recentRetentionMinutes, 45,
        (value) => ({ recentRetentionMinutes: value }));
      this.#numeric(containerEl, "settings.forgottenWarning", current.forgottenWarningMinutes, 120,
        (value) => ({ forgottenWarningMinutes: value }));
    }

    this.#dailyNoteText(containerEl, "folder", current.dailyNoteFolder);
    this.#dailyNoteText(containerEl, "format", current.dailyNoteFormat);
    const ignoredHostFormat = ignoredHostDailyNoteFormat(this.#dependencies.hostDailyNote?.());
    if (ignoredHostFormat !== undefined) {
      const hint = containerEl.ownerDocument.createElement("p");
      hint.className = "spiral-day-settings-host-ignored";
      hint.textContent = this.#dependencies.messages.t(
        "execution",
        "settings.dailyNoteFormatHostIgnored",
        { format: ignoredHostFormat },
      );
      containerEl.append(hint);
    }
  }

  override hide(): void {
    this.#displayGeneration += 1;
    super.hide();
  }

  #appendOnboarding(container: HTMLElement): void {
    const card = container.ownerDocument.createElement("section");
    card.className = "spiral-day-settings-onboarding";
    const title = container.ownerDocument.createElement("h3");
    title.textContent = this.#dependencies.messages.t("execution", "settings.onboardingTitle");
    card.append(title);
    const kind = settingsOnboardingKind(this.#dependencies.planSnapshot?.());
    const intro = this.#dependencies.messages.t("execution", "settings.onboardingDetail");
    if (kind === "ready") {
      const detail = container.ownerDocument.createElement("p");
      detail.className = "spiral-day-onboarding__intro";
      detail.textContent = intro;
      card.append(detail);
    } else if (kind === "empty") {
      const detail = container.ownerDocument.createElement("p");
      detail.className = "spiral-day-onboarding__intro";
      detail.textContent = intro;
      card.append(detail);
      renderEmptyPlanGuidance(card, this.#dependencies.messages);
    } else {
      renderPlanMissingGuidance(card, this.#dependencies.messages, {
        intro,
        ...(this.#dependencies.insertPrimaryPlan
          ? { onInsertPrimaryPlan: this.#dependencies.insertPrimaryPlan }
          : {}),
      });
    }
    const execution = container.ownerDocument.createElement("p");
    execution.textContent = this.#dependencies.messages.t("execution", "settings.onboardingExecution");
    card.append(execution);
    container.append(card);
  }

  #select<Key extends keyof PluginSettings, Value extends PluginSettings[Key] & number>(
    container: HTMLElement,
    label: SettingsMessageKey,
    current: Value,
    values: readonly Value[],
    patch: (value: Value) => Pick<PluginSettings, Key>,
  ): void {
    const generation = this.#displayGeneration;
    new Setting(container)
      .setName(this.#dependencies.messages.t("execution", label))
      .addDropdown((dropdown) => dropdown
        .addOptions(choices(values))
        .setValue(String(current))
        .onChange((value) => this.#run(generation, () =>
          this.#dependencies.update(patch(Number(value) as Value)))));
  }

  #text<Key extends keyof PluginSettings>(
    container: HTMLElement,
    label: SettingsMessageKey,
    current: string,
    patch: (value: string) => Pick<PluginSettings, Key>,
    description?: SettingsMessageKey,
  ): void {
    const generation = this.#displayGeneration;
    const setting = new Setting(container)
      .setName(this.#dependencies.messages.t("execution", label));
    if (description) setting.setDesc(this.#dependencies.messages.t("execution", description));
    setting.addText((text) => text
      .setValue(current)
      .onChange((value) => this.#run(generation, () => this.#dependencies.update(patch(value)))));
  }

  #dailyNoteText(
    container: HTMLElement,
    field: DailyNoteSettingField,
    current: string,
  ): void {
    const generation = this.#displayGeneration;
    const label = field === "folder" ? "settings.dailyNoteFolder" : "settings.dailyNoteFormat";
    const description = field === "folder" ? "settings.dailyNoteFolderDesc" : "settings.dailyNoteFormatDesc";
    const key = field === "folder" ? "dailyNoteFolder" : "dailyNoteFormat";
    const setting = new Setting(container)
      .setName(this.#dependencies.messages.t("execution", label))
      .setDesc(this.#dependencies.messages.t("execution", description));
    setting.addText((text) => {
      text.setValue(current);
      const persistIfAccepted = (submitted: string, finalize: boolean): void => {
        const result = interpretDailyNoteSetting(field, submitted);
        if (result.kind === "accept") {
          if (result.value !== this.#dependencies.settings()[key]) {
            this.#run(generation, () => this.#dependencies.update({ [key]: result.value }));
          }
          if (finalize && result.value !== text.inputEl.value) text.setValue(result.value);
          return;
        }
        if (!finalize) return;
        text.setValue(this.#dependencies.settings()[key]);
        new Notice(this.#dependencies.messages.t("execution", result.notice), 6_000);
      };
      text.onChange((value) => persistIfAccepted(value, false));
      text.inputEl.addEventListener("blur", () => persistIfAccepted(text.inputEl.value, true));
    });
  }

  #numeric<Key extends keyof PluginSettings>(
    container: HTMLElement,
    label: SettingsMessageKey,
    current: number,
    fallback: number,
    patch: (value: number) => Pick<PluginSettings, Key>,
  ): void {
    const generation = this.#displayGeneration;
    new Setting(container)
      .setName(this.#dependencies.messages.t("execution", label))
      .addText((text) => text
        .setValue(String(current))
        .onChange((raw) => {
          const value = numericMinutes(raw, fallback);
          if (value === undefined) return;
          this.#run(generation, () => this.#dependencies.update(patch(value)));
        }));
  }

  #run(generation: number, operation: () => void | Promise<void>): void {
    void Promise.resolve().then(operation).catch(this.#dependencies.onError).finally(() => {
      if (generation === this.#displayGeneration) this.#dependencies.onLocaleChanged();
    });
  }
}
