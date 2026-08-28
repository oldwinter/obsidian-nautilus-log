const UNICODE_WHITESPACE = /\p{White_Space}/u;

export function isUnicodeWhitespace(character: string | undefined): boolean {
  return character !== undefined && UNICODE_WHITESPACE.test(character);
}

export function removeUnicodeWhitespace(value: string): string {
  return value.replace(/\p{White_Space}/gu, "");
}

export function collapseUnicodeWhitespace(value: string): string {
  return value.replace(/\p{White_Space}+/gu, " ").trim();
}
