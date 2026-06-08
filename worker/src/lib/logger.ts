const REDACTED = "[redacted]";
const MAX_DEPTH = 5;
const MAX_STRING_LENGTH = 300;
const sensitiveKeyPattern =
  /(token|secret|password|authorization|cookie|api.?key|api_key|resultToken|gemini|stripe|resend|turnstile|szamlazz|agentKey|webhookSecret)/i;

function sanitizeString(value: string): string {
  const redacted = value
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, `$1${REDACTED}`)
    .replace(/([?&]key=)[^&\s]+/gi, `$1${REDACTED}`)
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, REDACTED)
    .replace(/sk_(?:test|live)_[A-Za-z0-9]+/g, REDACTED)
    .replace(/whsec_[A-Za-z0-9]+/g, REDACTED);

  return redacted.length > MAX_STRING_LENGTH
    ? `${redacted.slice(0, MAX_STRING_LENGTH)}...`
    : redacted;
}

export function redactSensitive(
  value: unknown,
  key = "",
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  try {
    if (key && sensitiveKeyPattern.test(key)) {
      return REDACTED;
    }

    if (typeof value === "string") {
      return sanitizeString(value);
    }
    if (
      value === null ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value;
    }
    if (typeof value === "bigint") {
      return value.toString();
    }
    if (typeof value === "undefined") {
      return undefined;
    }
    if (typeof value === "symbol") {
      return value.toString();
    }
    if (typeof value === "function") {
      return "[function]";
    }

    if (typeof value !== "object") {
      return "[unserializable]";
    }
    if (depth >= MAX_DEPTH) {
      return "[max-depth]";
    }
    if (seen.has(value)) {
      return "[cycle]";
    }
    seen.add(value);

    if (value instanceof Error) {
      const output: Record<string, unknown> = {
        name: sanitizeString(value.name),
        message: sanitizeString(value.message),
      };
      if (value.stack) {
        output.stack = sanitizeString(value.stack);
      }
      return output;
    }

    if (Array.isArray(value)) {
      return value.map((item) => redactSensitive(item, "", depth + 1, seen));
    }

    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactSensitive(entryValue, entryKey, depth + 1, seen),
      ]),
    );
  } catch {
    return "[redaction-error]";
  }
}

export function logEvent(event: string, details: Record<string, unknown> = {}) {
  const sanitizedDetails = redactSensitive(details);

  console.log(
    JSON.stringify({
      event,
      ...(typeof sanitizedDetails === "object" && sanitizedDetails !== null
        ? sanitizedDetails
        : {}),
      timestamp: new Date().toISOString(),
    }),
  );
}
