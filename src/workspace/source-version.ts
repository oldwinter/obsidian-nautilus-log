export interface SourceSnapshot {
  readonly file: string;
  readonly contentDigest: string;
  readonly contentLength: number;
}

export interface SourceVersion extends SourceSnapshot {}

export interface SourceSpan {
  readonly fromOffset: number;
  readonly toOffset: number;
  readonly fromLine: number;
  readonly fromColumn: number;
  readonly toLine: number;
  readonly toColumn: number;
}

interface SourcePosition {
  readonly line: number;
  readonly column: number;
}

function validateOffset(content: string, offset: number): void {
  if (!Number.isInteger(offset) || offset < 0 || offset > content.length) {
    throw new RangeError(`Source offset ${String(offset)} is outside the UTF-16 source`);
  }
}

function positionAt(content: string, offset: number): SourcePosition {
  let line = 0;
  let column = 0;

  for (let index = 0; index < offset; index += 1) {
    const codeUnit = content[index];
    if (codeUnit === "\r") {
      if (content[index + 1] === "\n" && index + 1 < offset) index += 1;
      line += 1;
      column = 0;
    } else if (codeUnit === "\n") {
      line += 1;
      column = 0;
    } else {
      column += 1;
    }
  }

  return { line, column };
}

async function sha256(content: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("SHA-256 requires the public Web Crypto API");

  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(content));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createSourceVersion(
  file: string,
  content: string,
): Promise<SourceVersion> {
  if (file.length === 0) throw new TypeError("Source file must be non-empty");
  return Object.freeze({
    file,
    contentDigest: await sha256(content),
    contentLength: content.length,
  });
}

export function createSourceSpan(
  content: string,
  fromOffset: number,
  toOffset: number,
): SourceSpan {
  validateOffset(content, fromOffset);
  validateOffset(content, toOffset);
  if (toOffset < fromOffset) {
    throw new RangeError("Source span toOffset must not precede fromOffset");
  }

  const from = positionAt(content, fromOffset);
  const to = positionAt(content, toOffset);
  return Object.freeze({
    fromOffset,
    toOffset,
    fromLine: from.line,
    fromColumn: from.column,
    toLine: to.line,
    toColumn: to.column,
  });
}

export function sourceSpanText(content: string, span: SourceSpan): string {
  validateOffset(content, span.fromOffset);
  validateOffset(content, span.toOffset);
  if (span.toOffset < span.fromOffset) {
    throw new RangeError("Source span toOffset must not precede fromOffset");
  }
  return content.slice(span.fromOffset, span.toOffset);
}

export async function sourceVersionMatches(
  version: SourceVersion,
  file: string,
  content: string,
): Promise<boolean> {
  if (version.file !== file || version.contentLength !== content.length) return false;
  return version.contentDigest === await sha256(content);
}
