import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { render, seoRoutes, notFoundSeo, buildHeadTags, siteUrl, isProductionSite } from "../dist-ssr/entry-server.js";
const template = await readFile("dist/index.html", "utf8");
if (!template.includes('<!--seo:start-->') || !template.includes('<div id="root"></div>')) throw new Error("Prerender template markers are missing");
for (const route of [...seoRoutes, notFoundSeo]) {
  const file = route.path === "/" ? "dist/index.html" : `dist${route.path.replace(/\.html$/, "")}.html`;
  const content = route.render === "prerender" ? render(route.path) : "";
  const html = template.replace(/<!--seo:start-->[\s\S]*?<!--seo:end-->/, () => `<!--seo:start-->\n${buildHeadTags(route)}\n<!--seo:end-->`).replace('<div id="root"></div>', () => `<div id="root">${content}</div>`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, html);
}
const entries = isProductionSite ? seoRoutes.filter((r) => r.robots === "index,follow" && r.lastmod) : [];
await writeFile("dist/sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.map((r) => `\n<url><loc>${siteUrl}${r.path}</loc><lastmod>${r.lastmod}</lastmod></url>`).join("")}\n</urlset>\n`);
console.log(`Prerendered ${seoRoutes.length} routes and a true 404 shell.`);
