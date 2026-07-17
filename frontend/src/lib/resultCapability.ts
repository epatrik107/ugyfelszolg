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
