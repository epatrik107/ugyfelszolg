import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { seoRoutes, notFoundSeo, siteUrl, isProductionSite } from '../dist-ssr/entry-server.js';
const capture = (html, expression) => [...html.matchAll(expression)].map((m) => m[1]);
export function verifyHtml(html, route, seen = new Set()) {
  const titles = capture(html, /<title\b[^>]*>([\s\S]*?)<\/title>/g);
  assert.equal(titles.length, 1, `${route.path}: exactly one title required`);
  assert.ok(!seen.has(titles[0]), `${route.path}: duplicate title`); seen.add(titles[0]);
  const descriptions = capture(html, /<meta\b[^>]*name="description"[^>]*content="([^"]*)"/g);
  assert.equal(descriptions.length, 1, `${route.path}: exactly one description required`);
  assert.ok(descriptions[0].length > 0 && descriptions[0].length <= 160, `${route.path}: description length`);
  const canonicals = capture(html, /<link\b[^>]*rel="canonical"[^>]*href="([^"]*)"/g);
  const indexable = route.robots === 'index,follow';
  assert.equal(canonicals.length, indexable ? 1 : 0, `${route.path}: canonical count`);
  if (indexable) assert.equal(canonicals[0], siteUrl + route.path, `${route.path}: canonical URL`);
  const robots = capture(html, /<meta\b[^>]*name="robots"[^>]*content="([^"]*)"/g);
  assert.deepEqual(robots, [isProductionSite ? route.robots : 'noindex,nofollow'], `${route.path}: robots`);
  if (route.render === 'prerender') {
    assert.equal((html.match(/<h1\b/g) || []).length, 1, `${route.path}: exactly one H1 required`);
    assert.ok(!html.includes('<div id="root"></div>'), `${route.path}: missing prerender`);
  } else assert.ok(html.includes('<div id="root"></div>'), `${route.path}: shell must be empty`);
  for (const json of capture(html, /<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) JSON.parse(json);
}
export async function verifyBuild() {
  const app = await readFile('src/App.tsx', 'utf8');
  const paths = capture(app, /<Route path="([^"]+)"/g).filter((path) => path !== '*').sort();
  assert.deepEqual(paths, seoRoutes.map((r) => r.path).sort(), 'Router and SEO registry differ');
  const seen = new Set();
  for (const route of [...seoRoutes, notFoundSeo]) {
    const file = route.path === '/' ? 'dist/index.html' : `dist${route.path.replace(/\.html$/, '')}.html`;
    verifyHtml(await readFile(file, 'utf8'), route, seen);
  }
  const sitemap = await readFile('dist/sitemap.xml', 'utf8');
  const locations = capture(sitemap, /<loc>(.*?)<\/loc>/g);
  const expected = isProductionSite ? seoRoutes.filter((r) => r.robots === 'index,follow').map((r) => siteUrl + r.path) : [];
  assert.deepEqual(locations.sort(), expected.sort(), 'Sitemap must contain every indexable route and no utility pages');
  console.log(`SEO verified: ${seoRoutes.length} routes, unique metadata, canonical, robots, rendered H1, JSON-LD and sitemap.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await verifyBuild();
