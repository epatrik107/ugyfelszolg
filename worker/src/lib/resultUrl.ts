/**
 * Builds a browser-only result capability URL.
 *
 * The public order id remains in the query string, while the bearer token is
 * placed in the fragment. URL fragments are not sent to the web server, CDN,
 * proxy, or in the HTTP Referer header.
 */
export function buildResultCapabilityUrl(
  siteUrl: string,
  route: "sikeres-fizetes" | "sikertelen-fizetes",
  publicId: string,
  resultToken: string,
) {
  const base = siteUrl.replace(/\/+$/u, "");
  const url = new URL(`${base}/${route}`);
  url.searchParams.set("order", publicId);
  url.hash = new URLSearchParams({ token: resultToken }).toString();
  return url.toString();
}
