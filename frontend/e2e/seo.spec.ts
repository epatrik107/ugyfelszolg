import { test, expect } from "@playwright/test";
const indexable = ["/", "/level-keszites", "/arak", "/kapcsolat", "/aszf", "/adatkezeles"];
for (const path of indexable) test(`raw HTML and hydration ${path}`, async ({ page, request }) => {
  const response = await request.get(path);
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toMatch(/<h1\b/);
  expect(html).toContain(`rel="canonical" href="https://levelseged.hu${path}"`);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && /hydration|Minified React error|didn't match|hydrating/i.test(message.text())) errors.push(message.text()); });
  await page.goto(path + "?verify=seo");
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index,follow');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://levelseged.hu${path}`);
  await expect(page.locator('script#ld-route')).toHaveCount(1);
  expect(errors).toEqual([]);
});
test('SPA navigation updates and removes metadata', async ({page}) => {
  await page.goto('/');
  await page.getByRole('link', {name:'Árak megtekintése',exact:true}).click();
  await expect(page).toHaveTitle('Árak – levélírás 890 Ft-tól | Levélsegéd');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href','https://levelseged.hu/arak');
  await page.getByRole('link',{name:'Rendelési link',exact:true}).click();
  await expect(page).toHaveTitle('Rendelési link újraküldése | Levélsegéd');
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  await expect(page.locator('script#ld-route')).toHaveCount(0);
  await expect(page.locator('meta[property="og:url"]')).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content','noindex,follow');
});
for (const [value,label] of Object.entries({delivery:'Nem érkezett meg a csomag',invoice:'Hibás számlát kaptam',service:'Nem válaszol a szolgáltató',other:'Más ügyben írok',invalid:'Más ügyben írok'})) test(`case query ${value}`, async ({page}) => {
  const errors: string[] = [];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/level-keszites?eset='+value);
  await expect(page.getByRole('button',{name:label,exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href','https://levelseged.hu/level-keszites');
  expect(errors).toEqual([]);
});
test('utility pages have empty noindex shells; unknown route is 404', async ({request,page}) => {
  for (const path of ['/sikeres-fizetes','/sikertelen-fizetes','/rendeles-link']) {
    const response = await request.get(path);expect(response.status()).toBe(200);
    const html = await response.text();expect(html).toContain('<div id="root"></div>');expect(html).toMatch(/name="robots" content="noindex/);
  }
  const response = await page.goto('/unknown-seo-test');expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading',{level:1})).toHaveText('Az oldal nem található');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content','noindex,nofollow');
});
