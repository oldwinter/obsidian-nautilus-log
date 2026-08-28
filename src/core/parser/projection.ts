import type { InlineSegment, TokenLocation } from "../model";
import { collapseUnicodeWhitespace } from "./whitespace";

export type RemovalMap = ReadonlyMap<number, readonly TokenLocation[]>;

export function addRemoval(
  removals: Map<number, TokenLocation[]>,
  location: TokenLocation,
): void {
  const existing = removals.get(location.segmentIndex);
  if (existing) {
    existing.push(location);
  } else {
    removals.set(location.segmentIndex, [location]);
  }
}

export function maskedSemanticText(
  segment: InlineSegment,
  segmentIndex: number,
  removals: RemovalMap,
): string {
  const locations = removals.get(segmentIndex);
  if (!locations || locations.length === 0) return segment.text;

  const characters = segment.text.split("");
  for (const location of locations) {
    for (let index = location.fromOffset; index < location.toOffset; index += 1) {
      characters[index] = "\0";
    }
  }
  return characters.join("");
}

export function renderLabel(
  segments: readonly InlineSegment[],
  removals: RemovalMap,
): string {
  let rendered = "";
  for (const [segmentIndex, segment] of segments.entries()) {
    if (segment.kind === "hidden") continue;

    const locations = removals.get(segmentIndex) ?? [];
    for (let index = 0; index < segment.text.length; index += 1) {
      const removed = locations.some(
        (location) => index >= location.fromOffset && index < location.toOffset,
      );
      if (!removed) rendered += segment.text[index];
    }
  }

  return collapseUnicodeWhitespace(rendered.replaceAll("---", ""));
}
