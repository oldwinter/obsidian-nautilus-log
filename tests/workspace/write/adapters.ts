import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import {
  ObsidianAtomicTextAccess,
  type AtomicConfirmationReader,
  type AtomicTextAccess,
  type AtomicTransformDecision,
  type AtomicTransformResult,
} from "../../../src/workspace/commit.ts";
import type {
  SourceChange,
} from "../../../src/workspace/text-access.ts";
import type { SourceWritePrimitive } from "../../../src/workspace/receipt.ts";
import {
  MemoryTextAccess,
  normalizeVaultRelativePath,
  type SourceChangeListener,
  type Unsubscribe,
} from "../../../src/workspace/text-access.ts";

export type AtomicFault =
  | "before-callback"
  | "before-apply"
  | "apply-then-throw"
  | "partial-prefix"
  | "divergent-resolve"
  | "silent-noop";

const DISPOSABLE_PASS = process.env.OBS_SAFE_ADAPTER_PASS === "disposable-vault"
  || process.env.OBS_SAFE_ADAPTER_PASS === "disposable-editor";
const DEFAULT_PRIMITIVE: SourceWritePrimitive = process.env.OBS_SAFE_ADAPTER_PASS === "disposable-editor"
  ? "editor"
  : "vault-process";
const disposableRoots = new Set<string>();
if (DISPOSABLE_PASS) {
  process.once("exit", () => {
    for (const root of disposableRoots) rmSync(root, { recursive: true, force: true });
  });
}

export class MemoryAtomicTextAccess extends MemoryTextAccess implements AtomicTextAccess {
  readonly #primitives = new Map<string, SourceWritePrimitive>();
  readonly #faults = new Map<string, AtomicFault[]>();
  readonly #productionListeners = new Set<SourceChangeListener>();
  readonly transactionCounts = new Map<string, number>();
  readonly callbackCounts = new Map<string, number>();
  readonly #races = new Map<string, (source: string) => string>();
  readonly #beforeCallbackGates = new Map<string, { readonly entered: () => void; readonly wait: Promise<void> }>();
  readonly #primitiveReadGates = new Map<string, { readonly entered: () => void; readonly wait: Promise<void> }>();
  readonly #afterApplyGates = new Map<string, { readonly entered: () => void; readonly wait: Promise<void> }>();
  #failNextConfirmationRead = false;
  #failConfirmationAfterTransform = false;
  #insideAtomic = false;
  readonly #disposableRoot: string | undefined;
  #afterTransformReadRace: { remaining: number; armed: boolean; mutate: () => void } | undefined;

  constructor(files: Readonly<Record<string, string>>, primitive: SourceWritePrimitive = DEFAULT_PRIMITIVE) {
    super(files);
    for (const path of Object.keys(files)) this.#primitives.set(normalizeVaultRelativePath(path), primitive);
    if (!DISPOSABLE_PASS) {
      super.onChange((change) => this.#emit(change));
    }
    if (DISPOSABLE_PASS) {
      this.#disposableRoot = mkdtempSync(join(tmpdir(), "obs-safe-fixture-"));
      disposableRoots.add(this.#disposableRoot);
      for (const [path, text] of Object.entries(files)) {
        const absolute = this.#absolute(path);
        mkdirSync(dirname(absolute), { recursive: true });
        writeFileSync(absolute, text, "utf8");
      }
    }
  }

  override async listMarkdownPaths(signal?: AbortSignal): Promise<readonly string[]> {
    if (!this.#disposableRoot) return super.listMarkdownPaths(signal);
    if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
    const found: string[] = [];
    const visit = async (folder: string): Promise<void> => {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        const absolute = join(folder, entry.name);
        if (entry.isDirectory()) await visit(absolute);
        else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
          found.push(relative(this.#disposableRoot!, absolute).replaceAll("\\", "/"));
        }
      }
    };
    await visit(this.#disposableRoot);
    return Object.freeze(found.sort());
  }

  override async readText(path: string, signal?: AbortSignal): Promise<string | undefined> {
    if (!this.#disposableRoot) {
      if (this.#failNextConfirmationRead && !this.#insideAtomic) {
        this.#failNextConfirmationRead = false;
        throw new Error("injected authoritative reread failure");
      }
      const text = await super.readText(path, signal);
      this.#afterRead();
      return text;
    }
    if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
    if (this.#failNextConfirmationRead && !this.#insideAtomic) {
      this.#failNextConfirmationRead = false;
      throw new Error("injected authoritative reread failure");
    }
    try {
      const text = readFileSync(this.#absolute(path), "utf8");
      this.#afterRead();
      return text;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  override onChange(listener: SourceChangeListener): Unsubscribe {
    this.#productionListeners.add(listener);
    return () => this.#productionListeners.delete(listener);
  }

  override create(path: string, content: string): void {
    if (!this.#disposableRoot) return super.create(path, content);
    const normalized = normalizeVaultRelativePath(path);
    const absolute = this.#absolute(normalized);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content, { encoding: "utf8", flag: "wx" });
    this.#emit({ kind: "create", path: normalized });
  }

  override modify(path: string, content: string): void {
    if (!this.#disposableRoot) return super.modify(path, content);
    const normalized = normalizeVaultRelativePath(path);
    readFileSync(this.#absolute(normalized), "utf8");
    writeFileSync(this.#absolute(normalized), content, "utf8");
    this.#emit({ kind: "modify", path: normalized });
  }

  override delete(path: string): void {
    if (!this.#disposableRoot) return super.delete(path);
    const normalized = normalizeVaultRelativePath(path);
    unlinkSync(this.#absolute(normalized));
    this.#emit({ kind: "delete", path: normalized });
  }

  override rename(oldPath: string, path: string): void {
    if (!this.#disposableRoot) return super.rename(oldPath, path);
    const normalizedOldPath = normalizeVaultRelativePath(oldPath);
    const normalizedPath = normalizeVaultRelativePath(path);
    const destination = this.#absolute(normalizedPath);
    mkdirSync(dirname(destination), { recursive: true });
    renameSync(this.#absolute(normalizedOldPath), destination);
    this.#emit({ kind: "rename", path: normalizedPath, oldPath: normalizedOldPath });
  }

  override setEditorText(path: string, content: string): void {
    if (!this.#disposableRoot) return super.setEditorText(path, content);
    const normalized = normalizeVaultRelativePath(path);
    writeFileSync(this.#absolute(normalized), content, "utf8");
    this.#emit({ kind: "editor", path: normalized });
  }

  override notifyCacheChange(path: string): void {
    if (!this.#disposableRoot) return super.notifyCacheChange(path);
    this.#emit({ kind: "cache", path: normalizeVaultRelativePath(path) });
  }

  setPrimitive(path: string, primitive: SourceWritePrimitive): void {
    this.#primitives.set(normalizeVaultRelativePath(path), primitive);
  }

  fault(path: string, fault: AtomicFault): void {
    const normalized = normalizeVaultRelativePath(path);
    const queued = this.#faults.get(normalized) ?? [];
    queued.push(fault);
    this.#faults.set(normalized, queued);
  }

  raceBeforeCallback(path: string, mutate: (source: string) => string): void {
    this.#races.set(normalizeVaultRelativePath(path), mutate);
  }

  pauseBeforeCallback(path: string): { readonly entered: Promise<void>; readonly release: () => void } {
    const normalized = normalizeVaultRelativePath(path);
    let signalEntered!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => { signalEntered = resolve; });
    const wait = new Promise<void>((resolve) => { release = resolve; });
    this.#beforeCallbackGates.set(normalized, { entered: signalEntered, wait });
    return Object.freeze({ entered, release });
  }

  pauseNextPrimitiveRead(path: string): { readonly entered: Promise<void>; readonly release: () => void } {
    return this.#installGate(this.#primitiveReadGates, path);
  }

  pauseAfterApply(path: string): { readonly entered: Promise<void>; readonly release: () => void } {
    return this.#installGate(this.#afterApplyGates, path);
  }

  emitSyntheticChange(change: SourceChange): void {
    this.#emit(change);
  }

  failNextConfirmationRead(): void {
    this.#failNextConfirmationRead = true;
  }

  failConfirmationAfterNextTransform(): void {
    this.#failConfirmationAfterTransform = true;
  }

  raceAfterTransformReads(reads: number, mutate: () => void): void {
    if (!Number.isSafeInteger(reads) || reads < 1) throw new RangeError("reads must be positive");
    this.#afterTransformReadRace = { remaining: reads, armed: false, mutate };
  }

  #afterRead(): void {
    const race = this.#afterTransformReadRace;
    if (race?.armed) {
      race.remaining -= 1;
      if (race.remaining === 0) {
        this.#afterTransformReadRace = undefined;
        race.mutate();
      }
    }
  }

  primitiveFor(path: string): SourceWritePrimitive {
    return this.#primitives.get(normalizeVaultRelativePath(path)) ?? "vault-process";
  }

  async #readConfirmationText(path: string): Promise<string | undefined> {
    await this.#waitForGate(this.#primitiveReadGates, normalizeVaultRelativePath(path));
    return this.readText(path);
  }

  async atomicTransform<T>(
    path: string,
    transform: (currentText: string) => AtomicTransformDecision<T>,
    onEnter?: (primitive: SourceWritePrimitive, readConfirmationText: AtomicConfirmationReader) => void,
  ): Promise<AtomicTransformResult<T>> {
    const normalized = normalizeVaultRelativePath(path);
    if (this.#disposableRoot) return this.#productionAtomicTransform(normalized, transform, onEnter);
    this.transactionCounts.set(normalized, (this.transactionCounts.get(normalized) ?? 0) + 1);
    const fault = this.#faults.get(normalized)?.shift();
    if (fault === "before-callback") throw new Error("injected before callback");
    await this.#waitBeforeCallback(normalized);
    let current = await super.readText(normalized);
    if (current === undefined) throw new Error("source disappeared");
    const race = this.#races.get(normalized);
    if (race) {
      this.#races.delete(normalized);
      current = race(current);
      super.modify(normalized, current);
    }
    const readConfirmationText = () => this.#readConfirmationText(normalized);
    onEnter?.(this.primitiveFor(normalized), readConfirmationText);
    this.#insideAtomic = true;
    let decision: AtomicTransformDecision<T>;
    try {
      this.callbackCounts.set(normalized, (this.callbackCounts.get(normalized) ?? 0) + 1);
      decision = transform(current);
    } finally {
      this.#insideAtomic = false;
    }
    if (fault === "before-apply") throw new Error("injected before apply");
    if (fault === "silent-noop") return Object.freeze({ primitive: this.primitiveFor(normalized), value: decision.value, readConfirmationText });
    const written = fault === "partial-prefix" || fault === "divergent-resolve"
      ? this.#partialPrefix(current, decision.text)
      : decision.text;
    if (written !== current) super.modify(normalized, written);
    await this.#waitForGate(this.#afterApplyGates, normalized);
    if (this.#afterTransformReadRace) this.#afterTransformReadRace.armed = true;
    if (this.#failConfirmationAfterTransform) {
      this.#failConfirmationAfterTransform = false;
      this.#failNextConfirmationRead = true;
    }
    if (fault === "apply-then-throw" || fault === "partial-prefix") throw new Error("injected after apply");
    return Object.freeze({ primitive: this.primitiveFor(normalized), value: decision.value, readConfirmationText });
  }

  async #productionAtomicTransform<T>(
    normalized: string,
    transform: (currentText: string) => AtomicTransformDecision<T>,
    onEnter?: (primitive: SourceWritePrimitive, readConfirmationText: AtomicConfirmationReader) => void,
  ): Promise<AtomicTransformResult<T>> {
    this.transactionCounts.set(normalized, (this.transactionCounts.get(normalized) ?? 0) + 1);
    const fault = this.#faults.get(normalized)?.shift();
    if (fault === "before-callback") throw new Error("injected before callback");
    await this.#waitBeforeCallback(normalized);
    const race = this.#races.get(normalized);
    if (race) {
      this.#races.delete(normalized);
      const current = readFileSync(this.#absolute(normalized), "utf8");
      this.modify(normalized, race(current));
    }
    const countedTransform = (currentText: string): AtomicTransformDecision<T> => {
      this.#insideAtomic = true;
      try {
        this.callbackCounts.set(normalized, (this.callbackCounts.get(normalized) ?? 0) + 1);
        return transform(currentText);
      } finally {
        this.#insideAtomic = false;
      }
    };
    const primitive = this.primitiveFor(normalized);
    const editor = primitive === "editor" ? this.#editor(normalized, fault) : undefined;
    const access = new ObsidianAtomicTextAccess({
      text: this,
      editorForPath: () => editor as never,
      fileForPath: (candidate) => ({ path: candidate }) as never,
      vault: {
        process: async (_file: unknown, mutate: (text: string) => string) => {
          const current = readFileSync(this.#absolute(normalized), "utf8");
          const next = mutate(current);
          if (fault === "before-apply") throw new Error("injected before apply");
          if (fault === "silent-noop") return current;
          const written = fault === "partial-prefix" || fault === "divergent-resolve"
            ? this.#partialPrefix(current, next)
            : next;
          if (written !== current) {
            writeFileSync(this.#absolute(normalized), written, "utf8");
            this.#emit({ kind: "modify", path: normalized });
          }
          if (fault === "apply-then-throw" || fault === "partial-prefix") throw new Error("injected after apply");
          return written;
        },
      } as never,
    });
    let innerReader: AtomicConfirmationReader | undefined;
    const readConfirmationText = async () => {
      await this.#waitForGate(this.#primitiveReadGates, normalized);
      if (this.#failNextConfirmationRead) {
        this.#failNextConfirmationRead = false;
        throw new Error("injected authoritative reread failure");
      }
      const text = await innerReader?.();
      this.#afterRead();
      return text;
    };
    const result = await access.atomicTransform(normalized, countedTransform, (enteredPrimitive, reader) => {
      innerReader = reader;
      onEnter?.(enteredPrimitive, readConfirmationText);
    });
    innerReader = result.readConfirmationText;
    await this.#waitForGate(this.#afterApplyGates, normalized);
    if (this.#afterTransformReadRace) this.#afterTransformReadRace.armed = true;
    if (this.#failConfirmationAfterTransform) {
      this.#failConfirmationAfterTransform = false;
      this.#failNextConfirmationRead = true;
    }
    return Object.freeze({ primitive: result.primitive, value: result.value, readConfirmationText });
  }

  #editor(normalized: string, fault: AtomicFault | undefined): {
    readonly getValue: () => string;
    readonly transaction: (transaction: { readonly changes?: readonly {
      readonly from: { readonly line: number; readonly ch: number };
      readonly to: { readonly line: number; readonly ch: number };
      readonly text: string;
    }[] }) => void;
  } {
    const offsetAt = (text: string, position: { readonly line: number; readonly ch: number }): number => {
      let line = 0;
      let offset = 0;
      while (line < position.line && offset < text.length) {
        if (text[offset] === "\r" && text[offset + 1] === "\n") offset += 2;
        else if (text[offset] === "\r" || text[offset] === "\n") offset += 1;
        else {
          offset += 1;
          continue;
        }
        line += 1;
      }
      return offset + position.ch;
    };
    return {
      getValue: () => readFileSync(this.#absolute(normalized), "utf8"),
      transaction: ({ changes = [] }) => {
        const before = readFileSync(this.#absolute(normalized), "utf8");
        if (fault === "before-apply") throw new Error("injected before apply");
        if (fault === "silent-noop") return;
        let current = before;
        const withOffsets = changes.map((change) => ({
          change,
          from: offsetAt(before, change.from),
          to: offsetAt(before, change.to),
        })).sort((left, right) => right.from - left.from || right.to - left.to);
        for (const { change, from, to } of withOffsets) {
          current = current.slice(0, from) + change.text + current.slice(to);
        }
        const written = fault === "partial-prefix" || fault === "divergent-resolve"
          ? this.#partialPrefix(before, current)
          : current;
        writeFileSync(this.#absolute(normalized), written, "utf8");
        this.#emit({ kind: "editor", path: normalized });
        if (fault === "apply-then-throw" || fault === "partial-prefix") throw new Error("injected after apply");
      },
    };
  }

  #absolute(path: string): string {
    return join(this.#disposableRoot!, normalizeVaultRelativePath(path));
  }

  async #waitBeforeCallback(normalized: string): Promise<void> {
    const gate = this.#beforeCallbackGates.get(normalized);
    if (!gate) return;
    this.#beforeCallbackGates.delete(normalized);
    gate.entered();
    await gate.wait;
  }

  #installGate(
    gates: Map<string, { readonly entered: () => void; readonly wait: Promise<void> }>,
    path: string,
  ): { readonly entered: Promise<void>; readonly release: () => void } {
    const normalized = normalizeVaultRelativePath(path);
    let signalEntered!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => { signalEntered = resolve; });
    const wait = new Promise<void>((resolve) => { release = resolve; });
    gates.set(normalized, { entered: signalEntered, wait });
    return Object.freeze({ entered, release });
  }

  async #waitForGate(
    gates: Map<string, { readonly entered: () => void; readonly wait: Promise<void> }>,
    normalized: string,
  ): Promise<void> {
    const gate = gates.get(normalized);
    if (!gate) return;
    gates.delete(normalized);
    gate.entered();
    await gate.wait;
  }

  #partialPrefix(before: string, intended: string): string {
    if (before === intended) return before;
    const commonPrefix = (() => {
      let offset = 0;
      while (offset < before.length && offset < intended.length && before[offset] === intended[offset]) offset += 1;
      return offset;
    })();
    const writtenLength = Math.min(intended.length, Math.max(commonPrefix + 1, Math.ceil(intended.length / 2)));
    const partial = intended.slice(0, writtenLength) + before.slice(writtenLength);
    if (partial !== before && partial !== intended) return partial;
    return `${intended.slice(0, Math.max(0, intended.length - 1))}${before.slice(Math.max(0, intended.length - 1))}`;
  }

  #emit(change: SourceChange): void {
    const frozen = Object.freeze({ ...change });
    for (const listener of [...this.#productionListeners]) listener(frozen);
  }
}

export class TempVaultAtomicTextAccess implements AtomicTextAccess {
  readonly #listeners = new Set<SourceChangeListener>();
  readonly transactionCounts = new Map<string, number>();

  constructor(
    readonly root: string,
    readonly primitive: SourceWritePrimitive = "vault-process",
  ) {}

  async seed(files: Readonly<Record<string, string>>): Promise<void> {
    for (const [path, text] of Object.entries(files)) {
      const normalized = normalizeVaultRelativePath(path);
      const absolute = join(this.root, normalized);
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, text, "utf8");
    }
  }

  async listMarkdownPaths(): Promise<readonly string[]> {
    const found: string[] = [];
    const visit = async (folder: string): Promise<void> => {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        const absolute = join(folder, entry.name);
        if (entry.isDirectory()) await visit(absolute);
        else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
          found.push(relative(this.root, absolute).replaceAll("\\", "/"));
        }
      }
    };
    await visit(this.root);
    return Object.freeze(found.sort());
  }

  async readText(path: string): Promise<string | undefined> {
    try {
      return await readFile(join(this.root, normalizeVaultRelativePath(path)), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  onChange(listener: SourceChangeListener): Unsubscribe {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  primitiveFor(): SourceWritePrimitive {
    return this.primitive;
  }

  async atomicTransform<T>(
    path: string,
    transform: (currentText: string) => AtomicTransformDecision<T>,
    onEnter?: (primitive: SourceWritePrimitive, readConfirmationText: AtomicConfirmationReader) => void,
  ): Promise<AtomicTransformResult<T>> {
    const normalized = normalizeVaultRelativePath(path);
    const current = await this.readText(normalized);
    if (current === undefined) throw new Error("source disappeared");
    const readConfirmationText = () => this.readText(normalized);
    onEnter?.(this.primitive, readConfirmationText);
    this.transactionCounts.set(normalized, (this.transactionCounts.get(normalized) ?? 0) + 1);
    const decision = transform(current);
    if (decision.text !== current) {
      await writeFile(join(this.root, normalized), decision.text, "utf8");
      for (const listener of this.#listeners) listener(Object.freeze({ kind: "modify", path: normalized }));
    }
    return Object.freeze({ primitive: this.primitive, value: decision.value, readConfirmationText });
  }
}
