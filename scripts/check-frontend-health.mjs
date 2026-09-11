import assert from "node:assert/strict";
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
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  const html = await response.text();
  const asset = html.match(/<script[^>]+src="([^"]+)"/);
  assert.ok(asset, "Missing application script");
  const js = await fetch(new URL(asset[1], site));
  assert.equal(js.status, 200); assert.match(js.headers.get("content-type"), /javascript/);
  const route = await fetch(new URL("level-keszites", site));
  assert.ok([200, 404].includes(route.status));
  if (route.status === 404) assert.match(await route.text(), /src="[^\"]*spa-redirect\.js"/);
  if (process.env.EXPECTED_REVISION) {
    const stamp = await fetch(new URL(`build.json?verify=${Date.now()}`, site));
    assert.equal((await stamp.json()).revision, process.env.EXPECTED_REVISION);
  }
  console.log("Frontend HTTPS, security headers, assets, SPA fallback and revision verified.");
}
let error;
for (let attempt = 0; attempt < 12; attempt++) {
  try { await verify(); error = null; break; }
  catch (failure) { error = failure; if (attempt < 11) await new Promise((resolve) => setTimeout(resolve, 10000)); }
}
if (error) throw error;
