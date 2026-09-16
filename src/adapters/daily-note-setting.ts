import { acceptedDailyNoteFolder, acceptedDailyNoteFormat } from "../runtime/plugin-data";

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
