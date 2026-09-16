import type { App } from "obsidian";
import type { HostDailyNoteSeed } from "../runtime/plugin-data";

export async function readHostDailyNoteConfiguration(
  app: Pick<App, "vault">,
): Promise<HostDailyNoteSeed | undefined> {
  try {
    const path = `${app.vault.configDir}/daily-notes.json`;
    if (!await app.vault.adapter.exists(path)) return undefined;
    const parsed: unknown = JSON.parse(await app.vault.adapter.read(path));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const record = parsed as Record<string, unknown>;
    const folder = typeof record.folder === "string" ? record.folder : undefined;
    const format = typeof record.format === "string" ? record.format : undefined;
    if (folder === undefined && format === undefined) return undefined;
    return {
      ...(folder === undefined ? {} : { folder }),
      ...(format === undefined ? {} : { format }),
    };
  } catch {
    return undefined;
  }
}
