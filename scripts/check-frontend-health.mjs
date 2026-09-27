import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const policy = JSON.parse(readFileSync(new URL("../infra/frontend-security.json", import.meta.url), "utf8"));
const site = new URL(process.env.SITE_URL || "https://levelseged.hu");
assert.equal(site.protocol, "https:");
const required = ["content-security-policy", "strict-transport-security", "x-frame-options", "x-content-type-options", "referrer-policy"];
async function verify() {
  const http = new URL(site); http.protocol = "http:";
  const redirect = await fetch(http, { redirect: "manual", signal: AbortSignal.timeout(10000) });
  assert.ok([301, 302, 307, 308].includes(redirect.status), `HTTP must redirect (got ${redirect.status})`);
  assert.equal(new URL(redirect.headers.get("location"), http).protocol, "https:");
  const response = await fetch(new URL(`?verify=${process.env.EXPECTED_REVISION || Date.now()}`, site), { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200);
  for (const header of required) assert.ok(response.headers.get(header), `Missing ${header}`);
  for (const [header, value] of Object.entries(policy.headers)) assert.equal(response.headers.get(header), value, `Incorrect ${header}`);
  const html = await response.text();
  const asset = html.match(/<script[^>]+src="([^"]+)"/);
  assert.ok(asset, "Missing application script");
  const js = await fetch(new URL(asset[1], site));
  assert.equal(js.status, 200); assert.match(js.headers.get("content-type"), /javascript/);
  const sitemap = await fetch(new URL("sitemap.xml", site));
  assert.equal(sitemap.status, 200, "Sitemap is unavailable");
  const locations = [...(await sitemap.text()).matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
  assert.ok(locations.length >= 6, "Sitemap is missing core pages");
  const titles = new Set();
  for (const location of locations) {
    assert.equal(new URL(location).origin, site.origin, "Sitemap contains another origin");
    const page = await fetch(location, { redirect: "manual", signal: AbortSignal.timeout(10000) });
    assert.equal(page.status, 200, `${location}: must return 200 without redirect`);
    const source = await page.text();
    assert.match(source, /<h1\b/, `${location}: missing prerendered H1`);
    assert.doesNotMatch(source, /name="robots"[^>]*content="noindex/, `${location}: noindex`);
    const canonical = source.match(/rel="canonical"[^>]*href="([^"]*)"/)?.[1];
    assert.equal(canonical, location, `${location}: canonical mismatch`);
    const title = source.match(/<title[^>]*>(.*?)<\/title>/)?.[1];
    assert.ok(title && !titles.has(title), `${location}: missing or duplicate title`);
    titles.add(title);
  }
  for (const path of ["sikeres-fizetes", "sikertelen-fizetes", "rendeles-link"]) {
    const page = await fetch(new URL(path, site));
    assert.equal(page.status, 200, `${path}: utility page status`);
    assert.match(await page.text(), /name="robots"[^>]*content="noindex/, `${path}: missing noindex`);
  }
  const missing = await fetch(new URL(`nemletezo-seo-${Date.now()}`, site));
  assert.equal(missing.status, 404, "Unknown URLs must return 404");
  assert.match(await missing.text(), /name="robots"[^>]*content="noindex/);
  for (const path of ["favicon.ico", "apple-touch-icon.png", "images/logo-512.png", "images/og-levelseged.jpg"]) {
    assert.equal((await fetch(new URL(path, site))).status, 200, `${path}: asset missing`);
  }
  if (process.env.EXPECTED_REVISION) {
    const stamp = await fetch(new URL(`build.json?verify=${Date.now()}`, site));
    assert.equal((await stamp.json()).revision, process.env.EXPECTED_REVISION);
  }
  console.log("Frontend HTTPS, security headers, prerendered sitemap pages, noindex shells, true 404, assets and revision verified.");
}
let error;
for (let attempt = 0; attempt < 12; attempt++) {
  try { await verify(); error = null; break; }
  catch (failure) { error = failure; if (attempt < 11) await new Promise((resolve) => setTimeout(resolve, 10000)); }
}
if (error) throw error;
