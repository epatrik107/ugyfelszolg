const sensitiveKeyPattern = /(token|secret|password|authorization|api.?key|resultToken)/i;

function sanitizeValue(key: string, value: unknown): unknown {
  if (sensitiveKeyPattern.test(key)) {
    return "[redacted]";
  }
  if (typeof value === "string" && value.length > 300) {
    return `${value.slice(0, 300)}...`;
  }
  return value;
}

export function logEvent(event: string, details: Record<string, unknown> = {}) {
  const sanitizedDetails = Object.fromEntries(
    Object.entries(details).map(([key, value]) => [key, sanitizeValue(key, value)]),
  );

  console.log(
    JSON.stringify({
      event,
      ...sanitizedDetails,
      timestamp: new Date().toISOString(),
    }),
  );
}
