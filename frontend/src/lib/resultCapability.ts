export function readResultCapabilityToken(
  searchParams: URLSearchParams,
  hash: string,
) {
  const legacyQueryToken = searchParams.get("token");
  if (legacyQueryToken) return legacyQueryToken;

  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  return new URLSearchParams(fragment).get("token");
}

export function removeResultCapabilityFromBrowserUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("token");
  url.hash = "";
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}`,
  );
}

const STORAGE_PREFIX = "result-token:";
// Matches the server-side content retention window.
const TOKEN_TTL_MS = 90 * 86_400_000;

/**
 * Keeps the order capability on this device so closing the tab does not lose
 * access. Storage can be unavailable (private mode); the emailed link remains.
 */
export function saveResultToken(publicId: string, token: string, now = Date.now()) {
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${publicId}`, JSON.stringify({ token, savedAt: now }));
  } catch {
    // The confirmation email is the durable fallback.
  }
}

export function loadResultToken(publicId: string, now = Date.now()) {
  try {
    const legacy = window.sessionStorage.getItem(`${STORAGE_PREFIX}${publicId}`);
    if (legacy) return legacy;
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${publicId}`);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { token?: unknown; savedAt?: unknown };
    if (typeof saved.token !== "string" || typeof saved.savedAt !== "number" || now - saved.savedAt > TOKEN_TTL_MS) {
      window.localStorage.removeItem(`${STORAGE_PREFIX}${publicId}`);
      return null;
    }
    return saved.token;
  } catch {
    return null;
  }
}

export function pruneResultTokens(now = Date.now()) {
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith(STORAGE_PREFIX)) loadResultToken(key.slice(STORAGE_PREFIX.length), now);
    }
  } catch {
    // Nothing to prune without storage access.
  }
}
