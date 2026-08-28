export interface LogicalDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

export interface DailyNoteConfiguration {
  readonly folder: string;
  readonly format: string;
}

export const DEFAULT_DAILY_NOTE_CONFIGURATION: Readonly<DailyNoteConfiguration> = Object.freeze({
  folder: "",
  format: "YYYY-MM-DD",
});

export type DailyNoteResolutionFailureReason =
  | "missing-config"
  | "invalid-config"
  | "ambiguous-config";

export type DailyNotePathResolution =
  | {
      readonly ok: true;
      readonly path: string;
      readonly logicalDate: LogicalDate;
    }
  | {
      readonly ok: false;
      readonly reason: DailyNoteResolutionFailureReason;
      readonly message: string;
    };

type DateComponent = "year" | "month" | "day";
type DateToken = "YYYY" | "MM" | "M" | "DD" | "D";

interface TokenPart {
  readonly kind: "token";
  readonly token: DateToken;
  readonly component: DateComponent;
  readonly variableWidth: boolean;
}

interface LiteralPart {
  readonly kind: "literal";
  readonly value: string;
}

type FormatPart = TokenPart | LiteralPart;

interface CompiledConfiguration {
  readonly folder: string;
  readonly parts: readonly FormatPart[];
}

type CompilationResult =
  | { readonly ok: true; readonly configuration: CompiledConfiguration }
  | { readonly ok: false; readonly reason: DailyNoteResolutionFailureReason; readonly message: string };

const TOKEN_PARTS: Readonly<Record<DateToken, Omit<TokenPart, "kind" | "token">>> = {
  YYYY: { component: "year", variableWidth: false },
  MM: { component: "month", variableWidth: false },
  M: { component: "month", variableWidth: true },
  DD: { component: "day", variableWidth: false },
  D: { component: "day", variableWidth: true },
};

function failure(
  reason: DailyNoteResolutionFailureReason,
  message: string,
): DailyNotePathResolution {
  return Object.freeze({ ok: false, reason, message });
}

function compilationFailure(
  reason: DailyNoteResolutionFailureReason,
  message: string,
): CompilationResult {
  return { ok: false, reason, message };
}

function normalizeFolder(folder: string): string | undefined {
  if (typeof folder !== "string" || folder.includes("\0")) return undefined;
  const slashFolder = folder.replaceAll("\\", "/");
  if (slashFolder.startsWith("/") || /^[A-Za-z]:\//.test(slashFolder)) return undefined;

  const segments: string[] = [];
  for (const segment of slashFolder.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === ".." || /[<>:"|?*\u0000-\u001f]/.test(segment)) return undefined;
    segments.push(segment);
  }
  return segments.join("/");
}

function tokenAt(format: string, offset: number): DateToken | undefined {
  for (const token of ["YYYY", "MM", "DD", "M", "D"] as const) {
    if (format.startsWith(token, offset)) return token;
  }
  return undefined;
}

function pushLiteral(parts: FormatPart[], value: string): void {
  const previous = parts[parts.length - 1];
  if (previous?.kind === "literal") {
    parts[parts.length - 1] = { kind: "literal", value: previous.value + value };
  } else {
    parts.push({ kind: "literal", value });
  }
}

function compileConfiguration(
  configuration: DailyNoteConfiguration | undefined,
): CompilationResult {
  if (configuration === undefined) {
    return compilationFailure("missing-config", "Daily Note configuration is required");
  }
  if (configuration === null || typeof configuration !== "object") {
    return compilationFailure("invalid-config", "Daily Note configuration contains an invalid folder or format");
  }
  const folder = normalizeFolder(configuration.folder);
  if (folder === undefined || typeof configuration.format !== "string") {
    return compilationFailure("invalid-config", "Daily Note configuration contains an invalid folder or format");
  }
  const format = configuration.format;
  if (format.length === 0 || format !== format.trim() || format.includes("\\")) {
    return compilationFailure("invalid-config", "Daily Note date format is invalid");
  }

  const parts: FormatPart[] = [];
  for (let offset = 0; offset < format.length;) {
    if (format[offset] === "[") {
      const closeOffset = format.indexOf("]", offset + 1);
      if (closeOffset < 0 || closeOffset === offset + 1) {
        return compilationFailure("invalid-config", "Daily Note date format has an invalid literal");
      }
      pushLiteral(parts, format.slice(offset + 1, closeOffset));
      offset = closeOffset + 1;
      continue;
    }
    if (format[offset] === "]") {
      return compilationFailure("invalid-config", "Daily Note date format has an invalid literal");
    }

    if (format.startsWith("YY", offset) && !format.startsWith("YYYY", offset)) {
      return compilationFailure("ambiguous-config", "Daily Note date format must contain a four-digit year");
    }
    const token = tokenAt(format, offset);
    if (token) {
      const tokenDefinition = TOKEN_PARTS[token];
      parts.push({ kind: "token", token, ...tokenDefinition });
      offset += token.length;
      continue;
    }
    const character = format[offset]!;
    if (/[A-Za-z]/.test(character)) {
      return compilationFailure("invalid-config", `Unsupported Daily Note date token at offset ${offset}`);
    }
    pushLiteral(parts, character);
    offset += 1;
  }

  const components = new Set(
    parts.flatMap((part) => part.kind === "token" ? [part.component] : []),
  );
  if (!["year", "month", "day"].every((component) => components.has(component as DateComponent))) {
    return compilationFailure(
      "ambiguous-config",
      "Daily Note date format must uniquely include year, month, and day",
    );
  }
  for (let index = 1; index < parts.length; index += 1) {
    const previous = parts[index - 1]!;
    const current = parts[index]!;
    if (
      previous.kind === "token"
      && current.kind === "token"
      && (previous.variableWidth || current.variableWidth)
    ) {
      return compilationFailure(
        "ambiguous-config",
        "Variable-width Daily Note date tokens require separators",
      );
    }
  }
  for (const [index, part] of parts.entries()) {
    if (part.kind !== "token" || !part.variableWidth) continue;
    const previous = parts[index - 1];
    const next = parts[index + 1];
    if (
      (previous?.kind === "literal" && /[0-9]$/.test(previous.value))
      || (next?.kind === "literal" && /^[0-9]/.test(next.value))
    ) {
      return compilationFailure(
        "ambiguous-config",
        "Variable-width Daily Note date tokens require nonnumeric separators",
      );
    }
  }

  return {
    ok: true,
    configuration: Object.freeze({ folder, parts: Object.freeze(parts) }),
  };
}

function isLogicalDate(date: LogicalDate): boolean {
  if (
    date === null
    || typeof date !== "object"
    || !Number.isInteger(date.year)
    || !Number.isInteger(date.month)
    || !Number.isInteger(date.day)
    || date.year < 1
    || date.year > 9999
    || date.month < 1
    || date.month > 12
  ) {
    return false;
  }
  const leapYear = date.year % 4 === 0 && (date.year % 100 !== 0 || date.year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return date.day >= 1 && date.day <= daysInMonth[date.month - 1]!;
}

function renderToken(token: DateToken, date: LogicalDate): string {
  switch (token) {
    case "YYYY": return String(date.year).padStart(4, "0");
    case "MM": return String(date.month).padStart(2, "0");
    case "M": return String(date.month);
    case "DD": return String(date.day).padStart(2, "0");
    case "D": return String(date.day);
  }
}

function renderRelativePath(parts: readonly FormatPart[], date: LogicalDate): string | undefined {
  const rendered = parts
    .map((part) => part.kind === "literal" ? part.value : renderToken(part.token, date))
    .join("");
  if (
    rendered.length === 0
    || rendered.startsWith("/")
    || rendered.endsWith("/")
    || rendered.includes("//")
    || rendered.toLowerCase().endsWith(".md")
    || /[<>:"|?*\\\u0000-\u001f]/.test(rendered)
  ) {
    return undefined;
  }
  const segments = rendered.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return undefined;
  }
  return rendered;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseCompiledPath(
  path: string,
  configuration: CompiledConfiguration,
): LogicalDate | undefined {
  if (
    path.length === 0
    || path.includes("\\")
    || path.startsWith("/")
    || path.includes("//")
    || !path.endsWith(".md")
  ) {
    return undefined;
  }
  const prefix = configuration.folder === "" ? "" : `${configuration.folder}/`;
  if (!path.startsWith(prefix)) return undefined;
  const formattedPath = path.slice(prefix.length, -3);

  const captures: DateComponent[] = [];
  let pattern = "^";
  for (const part of configuration.parts) {
    if (part.kind === "literal") {
      pattern += escapeRegex(part.value);
      continue;
    }
    captures.push(part.component);
    switch (part.token) {
      case "YYYY": pattern += "([0-9]{4})"; break;
      case "MM": pattern += "([0-9]{2})"; break;
      case "M": pattern += "([0-9]{1,2})"; break;
      case "DD": pattern += "([0-9]{2})"; break;
      case "D": pattern += "([0-9]{1,2})"; break;
    }
  }
  const match = new RegExp(`${pattern}$`).exec(formattedPath);
  if (!match) return undefined;

  const values = new Map<DateComponent, number>();
  for (const [index, component] of captures.entries()) {
    const value = Number(match[index + 1]);
    const existing = values.get(component);
    if (existing !== undefined && existing !== value) return undefined;
    values.set(component, value);
  }
  const logicalDate: LogicalDate = {
    year: values.get("year")!,
    month: values.get("month")!,
    day: values.get("day")!,
  };
  if (!isLogicalDate(logicalDate)) return undefined;
  const canonicalRelativePath = renderRelativePath(configuration.parts, logicalDate);
  if (canonicalRelativePath === undefined || `${prefix}${canonicalRelativePath}.md` !== path) {
    return undefined;
  }
  return Object.freeze(logicalDate);
}

export function resolveDailyNotePath(
  logicalDate: LogicalDate,
  configuration: DailyNoteConfiguration | undefined,
): DailyNotePathResolution {
  const compiled = compileConfiguration(configuration);
  if (!compiled.ok) return failure(compiled.reason, compiled.message);
  if (!isLogicalDate(logicalDate)) {
    return failure("invalid-config", "Logical Daily Note date is invalid");
  }
  const relativePath = renderRelativePath(compiled.configuration.parts, logicalDate);
  if (relativePath === undefined) {
    return failure("invalid-config", "Daily Note date format does not produce one normalized Markdown path");
  }
  const prefix = compiled.configuration.folder === "" ? "" : `${compiled.configuration.folder}/`;
  const path = `${prefix}${relativePath}.md`;
  const roundTripped = parseCompiledPath(path, compiled.configuration);
  if (
    !roundTripped
    || roundTripped.year !== logicalDate.year
    || roundTripped.month !== logicalDate.month
    || roundTripped.day !== logicalDate.day
  ) {
    return failure("ambiguous-config", "Daily Note date format does not round-trip the logical date");
  }
  return Object.freeze({ ok: true, path, logicalDate: roundTripped });
}

export function parseDailyNotePath(
  path: string,
  configuration: DailyNoteConfiguration | undefined,
): DailyNotePathResolution {
  const compiled = compileConfiguration(configuration);
  if (!compiled.ok) return failure(compiled.reason, compiled.message);
  const logicalDate = parseCompiledPath(path, compiled.configuration);
  if (!logicalDate) {
    return failure("invalid-config", "Path does not match the configured Daily Note convention");
  }
  return Object.freeze({ ok: true, path, logicalDate });
}
