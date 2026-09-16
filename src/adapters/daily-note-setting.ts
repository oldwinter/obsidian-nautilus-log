import {
  acceptedDailyNoteFolder,
  acceptedDailyNoteFormat,
  type HostDailyNoteSeed,
} from "../runtime/plugin-data";

export type DailyNoteSettingField = "folder" | "format";

export type DailyNoteSettingEdit =
  | { readonly kind: "accept"; readonly value: string }
  | {
      readonly kind: "reject";
      readonly notice: "settings.dailyNoteFolderRejected" | "settings.dailyNoteFormatRejected";
    };

export function interpretDailyNoteSetting(
  field: DailyNoteSettingField,
  submitted: string,
): DailyNoteSettingEdit {
  if (field === "folder") {
    const value = acceptedDailyNoteFolder(submitted);
    return value === undefined
      ? { kind: "reject", notice: "settings.dailyNoteFolderRejected" }
      : { kind: "accept", value };
  }
  const value = acceptedDailyNoteFormat(submitted);
  return value === undefined
    ? { kind: "reject", notice: "settings.dailyNoteFormatRejected" }
    : { kind: "accept", value };
}

export function ignoredHostDailyNoteFormat(host: HostDailyNoteSeed | undefined): string | undefined {
  if (typeof host?.format !== "string" || host.format.length === 0) return undefined;
  return acceptedDailyNoteFormat(host.format) === undefined ? host.format : undefined;
}
