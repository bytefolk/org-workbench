/**
 * Repairs human-readable values that were serialized one layer too deep by a
 * workspace importer. This is deliberately a display-only normalization:
 * the control-plane contracts and files remain untouched.
 */
const UNICODE_ESCAPE = /\\u([0-9a-fA-F]{4})/g;

export function decodeEscapedUnicode(value: string): string {
  return value.replace(UNICODE_ESCAPE, (_match, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}
