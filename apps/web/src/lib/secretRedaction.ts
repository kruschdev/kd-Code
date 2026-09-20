/**
 * @file secretRedaction.ts
 * Redacts sensitive credentials, private keys, tokens, and passwords
 * from prompts, diffs, and context inspection panels.
 */

const SECRET_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
  // OpenAI API Key
  { regex: /sk-[a-zA-Z0-9_-]{20,}/g, replacement: '[REDACTED_API_KEY]' },
  // Google AI / Gemini API Key
  { regex: /AIza[a-zA-Z0-9_-]{35}/g, replacement: '[REDACTED_GEMINI_KEY]' },
  // Anthropic API Key
  { regex: /sk-ant-[a-zA-Z0-9_-]{20,}/g, replacement: '[REDACTED_ANTHROPIC_KEY]' },
  // Generic Bearer Token
  { regex: /Bearer\s+([a-zA-Z0-9_\-\.]{20,})/gi, replacement: 'Bearer [REDACTED_TOKEN]' },
  // Generic key-value assignment for secret/key/token/password
  {
    regex: /(api[_-]?key|secret|token|password|auth_token|client_secret)\s*[:=]\s*["']?([a-zA-Z0-9_\-\.\$\!\#\%]{8,})["']?/gi,
    replacement: '$1: "[REDACTED_SECRET]"'
  },
  // Postgres connection strings with password
  {
    regex: /(postgres(?:ql)?:\/\/[^:]+:)([^@]+)(@[^/]+\/[^?\s]+)/gi,
    replacement: '$1****$3'
  }
];

export function redactSecrets(text: string): string {
  if (!text || typeof text !== 'string') return text;
  let sanitized = text;
  for (const { regex, replacement } of SECRET_PATTERNS) {
    sanitized = sanitized.replace(regex, replacement);
  }
  return sanitized;
}
