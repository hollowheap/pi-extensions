import { relative, sep } from "node:path";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const TRUNCATE_THRESHOLD = 4000;
const HEAD_LENGTH = 3000;
const TAIL_LENGTH = 1000;
const TARGET_LENGTH = 500;

export function truncateText(text: string, label = "truncated"): string {
  if (text.length <= TRUNCATE_THRESHOLD) return text;
  const cut = text.length - TRUNCATE_THRESHOLD;
  return `${text.slice(0, HEAD_LENGTH)}\n[${label}: cut ${cut} characters]\n${text.slice(-TAIL_LENGTH)}`;
}

export function displayTarget(target: string): string {
  const safe = sanitizeTerminalText(target);
  if (safe.length <= TARGET_LENGTH) return safe;
  const headLength = Math.floor(TARGET_LENGTH / 2);
  const tailLength = TARGET_LENGTH - headLength;
  const cut = safe.length - headLength - tailLength;
  return `${safe.slice(0, headLength)}\n[… cut ${cut} characters]\n${safe.slice(-tailLength)}`;
}

export function displayPath(base: string, absolute: string): string {
  const rel = relative(base, absolute).split(sep).join("/");
  return rel.endsWith("/") && rel.length > 1 ? rel.slice(0, -1) : rel;
}

function skipCsi(text: string, start: number): number {
  let index = start;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code >= 0x30 && code <= 0x3f) {
      index += 1;
    } else {
      break;
    }
  }
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code >= 0x20 && code <= 0x2f) {
      index += 1;
    } else {
      break;
    }
  }
  if (index < text.length) {
    const finalCode = text.charCodeAt(index);
    if (finalCode >= 0x40 && finalCode <= 0x7e) {
      index += 1;
    }
  }
  return index;
}

function skipControlString(text: string, start: number): number {
  let index = start;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code === 0x07 || code === 0x9c) {
      return index + 1;
    }
    if (code === 0x1b && text.charCodeAt(index + 1) === 0x5c) {
      return index + 2;
    }
    if (code === 0x0a) {
      return index;
    }
    index += 1;
  }
  return index;
}

/**
 * JSON for tool results. `JSON.stringify` already escapes quotes and control
 * bytes; also escape HTML-significant and line-separator characters so the
 * printed text cannot be reinterpreted as markup or split across lines.
 */
export function stringifyToolJson(value: unknown): string {
  const json = JSON.stringify(value) ?? "null";
  return json.replace(/[<>&\u2028\u2029]/g, (char) => {
    switch (char) {
      case "<":
        return "\\u003c";
      case ">":
        return "\\u003e";
      case "&":
        return "\\u0026";
      case "\u2028":
        return "\\u2028";
      default:
        return "\\u2029";
    }
  });
}

export interface SanitizeTerminalOptions {
  allowSgr?: boolean;
}

export function sanitizeTerminalText(
  text: string,
  options?: SanitizeTerminalOptions,
): string {
  const allowSgr = options?.allowSgr === true;
  let out = "";
  let index = 0;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code === 0x1b) {
      const next = text.charCodeAt(index + 1);
      if (next === 0x5b) {
        if (allowSgr) {
          let sgrIdx = index + 2;
          while (sgrIdx < text.length) {
            const p = text.charCodeAt(sgrIdx);
            if ((p >= 0x30 && p <= 0x39) || p === 0x3b || p === 0x3a) {
              sgrIdx += 1;
            } else {
              break;
            }
          }
          if (sgrIdx < text.length && text.charCodeAt(sgrIdx) === 0x6d) {
            out += text.slice(index, sgrIdx + 1);
            index = sgrIdx + 1;
            continue;
          }
        }
        index = skipCsi(text, index + 2);
        continue;
      }
      if (
        next === 0x5d ||
        next === 0x50 ||
        next === 0x58 ||
        next === 0x5e ||
        next === 0x5f
      ) {
        index = skipControlString(text, index + 2);
        continue;
      }
      index += 1;
      while (index < text.length) {
        const inter = text.charCodeAt(index);
        if (inter >= 0x20 && inter <= 0x2f) {
          index += 1;
        } else {
          break;
        }
      }
      if (index < text.length) {
        const finalCode = text.charCodeAt(index);
        if (finalCode >= 0x30 && finalCode <= 0x7e) {
          index += 1;
        }
      }
      continue;
    }
    if (code === 0x9b) {
      index = skipCsi(text, index + 1);
      continue;
    }
    if (
      (code <= 0x1f && code !== 0x09 && code !== 0x0a) ||
      (code >= 0x7f && code <= 0x9f)
    ) {
      index += 1;
      continue;
    }
    out += text[index];
    index += 1;
  }
  return out;
}

export interface ToolTextBlock {
  type: "text";
  text: string;
}

export interface ToolTextResult<TDetails = Record<string, unknown>> {
  content: ToolTextBlock[];
  details: TDetails;
}

export function toolTextResult(
  text: string,
): ToolTextResult<Record<string, never>>;
export function toolTextResult<TDetails>(
  text: string,
  details: TDetails,
): ToolTextResult<TDetails>;
export function toolTextResult<TDetails>(
  text: string,
  details?: TDetails,
): ToolTextResult<TDetails | Record<string, never>> {
  if (details === undefined) {
    const empty: Record<string, never> = {};
    return {
      content: [{ type: "text", text }],
      details: empty,
    };
  }
  return {
    content: [{ type: "text", text }],
    details,
  };
}

export function toolErrorResult(
  prefix: string,
  error: unknown,
): ToolTextResult<{ error: string }>;
export function toolErrorResult<TDetails>(
  prefix: string,
  error: unknown,
  details: TDetails,
): ToolTextResult<TDetails>;
export function toolErrorResult<TDetails>(
  prefix: string,
  error: unknown,
  details?: TDetails,
): ToolTextResult<TDetails | { error: string }> {
  const message = sanitizeTerminalText(errorMessage(error));
  const text = `${prefix}: ${message}`;
  if (details === undefined) {
    return toolTextResult(text, { error: message });
  }
  return toolTextResult(text, details);
}
