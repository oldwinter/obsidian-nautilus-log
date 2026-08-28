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

export type AsyncCheckpoint = () => Promise<void>;

async function encodeUtf8(
  content: string,
  checkpoint: AsyncCheckpoint | undefined,
): Promise<Uint8Array<ArrayBuffer>> {
  const encoder = new TextEncoder();
  if (!checkpoint) return encoder.encode(content);

  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let byteLength = 0;
  for (let fromOffset = 0; fromOffset < content.length;) {
    let toOffset = Math.min(fromOffset + 64 * 1024, content.length);
    const finalCodeUnit = content.charCodeAt(toOffset - 1);
    if (toOffset < content.length && finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) {
      toOffset -= 1;
    }
    const chunk = encoder.encode(content.slice(fromOffset, toOffset));
    chunks.push(chunk);
    byteLength += chunk.byteLength;
    fromOffset = toOffset;
    await checkpoint();
  }

  const encoded = new Uint8Array(byteLength);
  let writeOffset = 0;
  for (const chunk of chunks) {
    encoded.set(chunk, writeOffset);
    writeOffset += chunk.byteLength;
    await checkpoint();
  }
  return encoded;
}

async function sha256(content: string, checkpoint?: AsyncCheckpoint): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("SHA-256 requires the public Web Crypto API");

  const digest = await subtle.digest("SHA-256", await encodeUtf8(content, checkpoint));
  await checkpoint?.();
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function utf8ByteLength(content: string): number {
  let bytes = 0;
  for (let index = 0; index < content.length; index += 1) {
    const code = content.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < content.length) {
      const next = content.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

export async function utf8ByteLengthCooperative(
  content: string,
  checkpoint: AsyncCheckpoint,
): Promise<number> {
  let bytes = 0;
  for (let start = 0; start < content.length;) {
    let end = Math.min(start + 64 * 1024, content.length);
    const finalCodeUnit = content.charCodeAt(end - 1);
    if (end < content.length && finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) end -= 1;
    for (let index = start; index < end; index += 1) {
      const code = content.charCodeAt(index);
      if (code <= 0x7f) bytes += 1;
      else if (code <= 0x7ff) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff && index + 1 < content.length) {
        const next = content.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          bytes += 4;
          index += 1;
        } else {
          bytes += 3;
        }
      } else {
        bytes += 3;
      }
    }
    start = end;
    await checkpoint();
  }
  return bytes;
}

export async function createSourceVersion(
  file: string,
  content: string,
  checkpoint?: AsyncCheckpoint,
): Promise<SourceVersion> {
  if (file.length === 0) throw new TypeError("Source file must be non-empty");
  return Object.freeze({
    file,
    contentDigest: await sha256(content, checkpoint),
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
