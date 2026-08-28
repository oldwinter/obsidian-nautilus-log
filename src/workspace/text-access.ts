export const SOURCE_CHANGE_KINDS = Object.freeze([
  "create",
  "modify",
  "delete",
  "rename",
  "editor",
  "cache",
] as const);

export type SourceChangeKind = (typeof SOURCE_CHANGE_KINDS)[number];

export interface SourceChange {
  readonly kind: SourceChangeKind;
  readonly path: string;
  readonly oldPath?: string;
}

export type Unsubscribe = () => void;
export type SourceChangeListener = (change: SourceChange) => void;

export interface TextAccess {
  listMarkdownPaths(): Promise<readonly string[]>;
  readText(path: string): Promise<string | undefined>;
  onChange(listener: SourceChangeListener): Unsubscribe;
}

export function normalizeVaultRelativePath(path: string): string {
  if (typeof path !== "string" || path.length === 0 || path.includes("\0")) {
    throw new TypeError("Path must be a non-empty vault-relative path");
  }

  const slashPath = path.replaceAll("\\", "/");
  if (slashPath.startsWith("/") || /^[A-Za-z]:\//.test(slashPath)) {
    throw new TypeError(`Path is not vault-relative: ${path}`);
  }

  const segments: string[] = [];
  for (const segment of slashPath.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") throw new TypeError(`Path is not vault-relative: ${path}`);
    segments.push(segment);
  }
  if (segments.length === 0) throw new TypeError("Path must name a vault-relative file");
  return segments.join("/");
}

type InitialMemoryFiles =
  | Readonly<Record<string, string>>
  | Iterable<readonly [string, string]>;

function initialEntries(initialFiles: InitialMemoryFiles): Iterable<readonly [string, string]> {
  const iterable = initialFiles as Iterable<readonly [string, string]>;
  return typeof iterable[Symbol.iterator] === "function"
    ? iterable
    : Object.entries(initialFiles);
}

export class MemoryTextAccess implements TextAccess {
  readonly #files = new Map<string, string>();
  readonly #listeners = new Set<SourceChangeListener>();

  constructor(initialFiles: InitialMemoryFiles = {}) {
    for (const [path, content] of initialEntries(initialFiles)) {
      const normalizedPath = normalizeVaultRelativePath(path);
      if (this.#files.has(normalizedPath)) {
        throw new Error(`Memory file already exists after normalization: ${normalizedPath}`);
      }
      this.#files.set(normalizedPath, content);
    }
  }

  async listMarkdownPaths(): Promise<readonly string[]> {
    return Object.freeze(
      [...this.#files.keys()]
        .filter((path) => /\.md$/i.test(path))
        .sort((left, right) => left < right ? -1 : left > right ? 1 : 0),
    );
  }

  async readText(path: string): Promise<string | undefined> {
    return this.#files.get(normalizeVaultRelativePath(path));
  }

  onChange(listener: SourceChangeListener): Unsubscribe {
    this.#listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.#listeners.delete(listener);
    };
  }

  create(path: string, content: string): void {
    const normalizedPath = normalizeVaultRelativePath(path);
    if (this.#files.has(normalizedPath)) {
      throw new Error(`Memory file already exists: ${normalizedPath}`);
    }
    this.#files.set(normalizedPath, content);
    this.#emit({ kind: "create", path: normalizedPath });
  }

  modify(path: string, content: string): void {
    const normalizedPath = normalizeVaultRelativePath(path);
    this.#requireFile(normalizedPath);
    this.#files.set(normalizedPath, content);
    this.#emit({ kind: "modify", path: normalizedPath });
  }

  delete(path: string): void {
    const normalizedPath = normalizeVaultRelativePath(path);
    this.#requireFile(normalizedPath);
    this.#files.delete(normalizedPath);
    this.#emit({ kind: "delete", path: normalizedPath });
  }

  rename(oldPath: string, path: string): void {
    const normalizedOldPath = normalizeVaultRelativePath(oldPath);
    const normalizedPath = normalizeVaultRelativePath(path);
    if (normalizedOldPath === normalizedPath) {
      throw new Error("Memory file cannot be renamed to the same path");
    }
    const content = this.#requireFile(normalizedOldPath);
    if (this.#files.has(normalizedPath)) {
      throw new Error(`Memory file already exists: ${normalizedPath}`);
    }
    this.#files.delete(normalizedOldPath);
    this.#files.set(normalizedPath, content);
    this.#emit({ kind: "rename", path: normalizedPath, oldPath: normalizedOldPath });
  }

  setEditorText(path: string, content: string): void {
    const normalizedPath = normalizeVaultRelativePath(path);
    this.#requireFile(normalizedPath);
    this.#files.set(normalizedPath, content);
    this.#emit({ kind: "editor", path: normalizedPath });
  }

  notifyCacheChange(path: string): void {
    this.#emit({ kind: "cache", path: normalizeVaultRelativePath(path) });
  }

  #requireFile(path: string): string {
    const content = this.#files.get(path);
    if (content === undefined) throw new Error(`Memory file does not exist: ${path}`);
    return content;
  }

  #emit(change: SourceChange): void {
    const immutableChange = Object.freeze({ ...change });
    for (const listener of [...this.#listeners]) listener(immutableChange);
  }
}
