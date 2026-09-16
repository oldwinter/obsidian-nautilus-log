export function readHostLanguage(readLanguage?: () => string): string {
  if (typeof readLanguage === "function") {
    try {
      const locale = readLanguage();
      if (typeof locale === "string" && locale.trim() !== "") return locale;
    } catch {
      // Obsidian 1.7.7 hosts do not export getLanguage.
    }
  }
  try {
    const stored = globalThis.localStorage?.getItem("language");
    if (typeof stored === "string" && stored.trim() !== "") return stored;
  } catch {
    // Restricted or missing DOM storage.
  }
  return "en";
}
