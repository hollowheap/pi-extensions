export const REDACTED = "[REDACTED]";

const PRIVATE_KEY =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gi;

const TOKEN_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bnpm_[A-Za-z0-9]{20,}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{10,}\b/gi,
  /\bBasic\s+[A-Za-z0-9+/=]{10,}\b/gi,
];

const KEY_VALUE =
  /\b(api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|authorization|token|client[_-]?secret|password|secret)\b(\s*[:=]\s*)("[^"]{8,}"|'[^']{8,}'|[^\s,;&]{8,})/gi;

const URL_SECRET =
  /([?&](?:token|key|secret|password|access_token|api_key)=)([^&\s#]+)/gi;

export function redactSecrets(text: string): string {
  let result = text.replace(PRIVATE_KEY, REDACTED);
  for (const pattern of TOKEN_PATTERNS) {
    result = result.replace(pattern, REDACTED);
  }
  result = result.replace(KEY_VALUE, `$1$2${REDACTED}`);
  return result.replace(URL_SECRET, `$1${REDACTED}`);
}
