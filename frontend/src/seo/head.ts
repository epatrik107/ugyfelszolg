import { SITE_URL } from "../lib/config";
import { structuredData } from "./structuredData";
import type { RouteSeo } from "./routes";
export const siteUrl = SITE_URL.replace(/\/$/, "");
export const isProductionSite = siteUrl === "https://levelseged.hu";
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
export function buildHeadTags(route: RouteSeo) {
  const canonical = `${siteUrl}${route.path}`;
  const image = `${siteUrl}/images/og-levelseged.jpg`;
  const meta = (key: string, value: string, property = false) => `<meta data-route-head ${property ? "property" : "name"}="${key}" content="${escapeHtml(value)}">`;
  const tags = [
    `<title data-route-head>${escapeHtml(route.title)}</title>`,
    meta("description", route.description),
    meta("robots", isProductionSite ? route.robots : "noindex,nofollow"),
    meta("og:type", "website", true), meta("og:title", route.title, true), meta("og:description", route.description, true),
    meta("og:image", image, true), meta("og:image:width", "1200", true), meta("og:image:height", "630", true),
    meta("og:image:alt", "Levélsegéd – hivatalos levél írása online", true), meta("og:locale", "hu_HU", true), meta("og:site_name", "Levélsegéd", true),
    meta("twitter:card", "summary_large_image"), meta("twitter:title", route.title), meta("twitter:description", route.description), meta("twitter:image", image),
  ];
  if (route.robots === "index,follow") tags.push(`<link data-route-head rel="canonical" href="${escapeHtml(canonical)}">`, meta("og:url", canonical, true));
  if (route.path === "/") tags.push(`<link data-route-head rel="preload" as="image" type="image/avif" imagesrcset="${[640, 1024, 1600].map((width) => `${import.meta.env.BASE_URL}images/hero-letter-desk-${width}.avif ${width}w`).join(", ")}" imagesizes="100vw" fetchpriority="high">`);
  const data = structuredData(route, siteUrl);
  if (data.length) tags.push(`<script data-route-head type="application/ld+json" id="ld-route">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`);
  return tags.join("\n");
}
