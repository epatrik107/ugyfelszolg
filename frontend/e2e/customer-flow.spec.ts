import { test, expect, type Page } from "@playwright/test";

// External providers are stubbed only by this test runner, never by the app.
async function stubTurnstile(page: Page) {
  await page.route("https://challenges.cloudflare.com/**", (route) => route.fulfill({
    contentType: "application/javascript",
    body: `window.turnstile={render(node,options){const button=document.createElement('button');button.type='button';button.textContent='Tesztellenőrzés';button.onclick=()=>options.callback('test-token');node.appendChild(button);return 'test-widget';},remove(){},reset(){},getResponse(){return 'test-token';},isExpired(){return false;}};window.onTurnstileLoad?.();window.onloadTurnstileCallback?.();`,
  }));
}
async function stepOne(page: Page) {
  await page.goto("/level-keszites");
  await page.getByRole("button", { name: "Nem érkezett meg a csomag", exact: true }).click();
  await page.getByLabel("Webáruház neve", { exact: true }).fill("Minta Webáruház");
  await page.getByLabel("Mi történt pontosan?", { exact: true }).fill("Szeptember 2-án rendeltem egy lámpát, de az ígért időpontig nem érkezett meg.");
  await page.getByRole("button", { name: "Tovább", exact: true }).click();
}
async function stepTwo(page: Page) {
  await page.getByLabel("Milyen megoldást kér?", { exact: true }).fill("Kérem a vételár visszatérítését.");
  await page.getByLabel("Az Ön neve", { exact: true }).fill("Teszt Elek");
  await page.getByLabel("Emailcím a visszaigazoláshoz", { exact: true }).fill("teszt@example.invalid");
  await page.getByRole("button", { name: "Tovább", exact: true }).click();
}
async function review(page: Page) {
  await stubTurnstile(page);
  await stepOne(page);
  await stepTwo(page);
  await page.getByLabel("Irányítószám", { exact: true }).fill("1111");
  await page.getByLabel("Település", { exact: true }).fill("Budapest");
  await page.getByLabel("Közterület és házszám", { exact: true }).fill("Teszt utca 1.");
  // Synthetic local purchase: accepting these terms cannot create a real order.
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Összegzés megnyitása", exact: true }).click();
}
const letter = "Tárgy: Panasz\n\nTisztelt Ügyfélszolgálat!\nKérem a hibás számla javítását.\n\nÜdvözlettel:\nTeszt Elek";
const completed = {
  paymentStatus: "paid", aiStatus: "completed", generationCount: 1,
  selectedPackage: "basic", invoiceStatus: "created", refundStatus: null,
  generatedLetter: letter, letterHistory: [], createdAt: "2026-09-12T10:00:00Z",
};
async function order(page: Page, data: object = completed) {
  await page.route("**/api/orders/ui-test/result", (route) => route.fulfill({ json: { ok: true, data } }));
  await page.goto("/sikeres-fizetes?order=ui-test#token=abcdefghijklmnopqrstuvwxyz123456");
}

test("inline validation, context cards and back navigation retain values", async ({ page }, testInfo) => {
  await page.goto("/level-keszites");
  await page.getByRole("button", { name: "Tovább", exact: true }).click();
  await expect(page.locator("#recipient")).toBeFocused();
  await expect(page.locator("#recipient-error")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Számlázási adatok" })).toBeHidden();
  await stepOne(page);
  await page.getByLabel("Milyen megoldást kér?", { exact: true }).fill("csere");
  await page.getByRole("button", { name: "Tovább", exact: true }).click();
  await expect(page.locator("#desiredResult-error")).toContainText("legalább 10");
  await page.getByRole("button", { name: "Vissza", exact: true }).click();
  await expect(page.getByLabel("Webáruház neve", { exact: true })).toHaveValue("Minta Webáruház");
  await page.getByRole("button", { name: "Hibás számlát kaptam", exact: true }).click();
  await expect(page.getByLabel("Mi történt pontosan?", { exact: true })).toHaveValue(/lámpát/);
  await expect(page.getByText("Melyik számla hibás?", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Hibás számlát kaptam", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: testInfo.outputPath("form.png"), fullPage: true });
});

test("billing autofill, full review and editing preserve purchase data", async ({ page }, testInfo) => {
  await review(page);
  await page.screenshot({ path: testInfo.outputPath("review.png"), fullPage: true });
  const summary = page.getByRole("region", { name: "Fizetés előtti összegzés", exact: true });
  await expect(summary).toBeFocused();
  await expect(summary.getByText("Kérem a vételár visszatérítését.", { exact: true })).toBeVisible();
  await expect(summary.getByRole("button", { name: /Biztonságos fizetés · 890 Ft/ })).toBeDisabled();
  await page.getByRole("button", { name: "Adatok és csomag módosítása" }).click();
  await expect(page.getByLabel("Számlázási név", { exact: true })).toHaveValue("Teszt Elek");
  await expect(page.getByLabel("Irányítószám", { exact: true })).toHaveValue("1111");
  await page.getByRole("button", { name: "Vissza", exact: true }).click();
  await expect(page.getByLabel("Milyen megoldást kér?", { exact: true })).toHaveValue("Kérem a vételár visszatérítését.");
});

test("failed checkout retains data, requires a fresh check and reuses attempt ID", async ({ page }) => {
  const payloads: Record<string, any>[] = [];
  await page.route("**/api/create-checkout-session", (route) => {
    payloads.push(route.request().postDataJSON());
    return route.fulfill({ status: 503, json: { ok: false, error: { code: "TEMPORARY", message: "Átmeneti szolgáltatói hiba." } } });
  });
  await review(page);
  await page.getByRole("button", { name: "Tesztellenőrzés", exact: true }).click();
  await page.getByRole("button", { name: /Biztonságos fizetés · 890 Ft/ }).click();
  await expect(page.getByRole("alert")).toContainText("Az adatai megmaradtak");
  await expect(page.getByRole("button", { name: /Biztonságos fizetés · 890 Ft/ })).toBeDisabled();
  await page.getByRole("button", { name: "Tesztellenőrzés", exact: true }).click();
  await page.getByRole("button", { name: /Biztonságos fizetés · 890 Ft/ }).click();
  await expect.poll(() => payloads.length).toBe(2);
  expect(payloads[0].checkoutAttemptId).toBe(payloads[1].checkoutAttemptId);
  expect(payloads[1].recipient).toBe("Minta Webáruház");
  expect(payloads[1].billing.name).toBe("Teszt Elek");
});

test("payment redirect uses the returned checkout URL", async ({ page }) => {
  await page.route("**/api/create-checkout-session", (route) => route.fulfill({ json: { ok: true, data: { checkoutUrl: "http://127.0.0.1:4173/test-checkout", publicId: "ui-test" } } }));
  await review(page);
  await page.getByRole("button", { name: "Tesztellenőrzés", exact: true }).click();
  await page.getByRole("button", { name: /Biztonságos fizetés · 890 Ft/ }).click();
  await expect(page).toHaveURL(/test-checkout$/);
});

test("copy and download use edited text; original can be restored", async ({ page }, testInfo) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text: string) => { (window as any).copiedText = text; } } }); });
  await order(page);
  await page.screenshot({ path: testInfo.outputPath("letter.png"), fullPage: true });
  await page.getByRole("button", { name: "Szerkesztés", exact: true }).click();
  await page.getByLabel("Levél szövegének szerkesztése", { exact: true }).fill("Saját javítás, magyar ékezetek: őű.");
  await page.getByRole("button", { name: "Kész", exact: true }).click();
  await page.getByRole("button", { name: "Másolás", exact: true }).click();
  expect(await page.evaluate(() => (window as any).copiedText)).toBe("Saját javítás, magyar ékezetek: őű.");
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Letöltés", exact: true }).click();
  const download = await downloadEvent;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString("utf8")).toBe("Saját javítás, magyar ékezetek: őű.");
  await page.getByRole("button", { name: "Szerkesztés visszavonása" }).click();
  await expect(page.getByTestId("letter-text")).toHaveText(letter);
});

test("clipboard failure gives useful feedback without claiming success", async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => { throw new Error("Denied"); } } }); });
  await order(page);
  await page.getByRole("button", { name: "Másolás", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("nem engedélyezte");
});

test("history selection and quick modification preserve old letter while processing", async ({ page }) => {
  let data = { ...completed, selectedPackage: "premium", generationCount: 2, letterHistory: ["Korábbi levél szövege."] };
  let feedback = "";
  await page.route("**/api/orders/ui-test/regenerate", (route) => {
    feedback = route.request().postDataJSON().feedback;
    data = { ...data, aiStatus: "generating" };
    return route.fulfill({ json: { ok: true, data: {} } });
  });
  await page.route("**/api/orders/ui-test/result", (route) => route.fulfill({ json: { ok: true, data } }));
  await page.goto("/sikeres-fizetes?order=ui-test#token=abcdefghijklmnopqrstuvwxyz123456");
  await page.getByLabel("Megjelenített változat", { exact: true }).selectOption("0");
  await expect(page.getByTestId("letter-text")).toHaveText("Korábbi levél szövege.");
  await expect(page.getByText(/Minden alábbi gomb 1 AI-módosítást/)).toBeVisible();
  await page.getByRole("button", { name: "Legyen rövidebb", exact: true }).click();
  await expect.poll(() => feedback).toBe("Legyen rövidebb");
  await expect(page.getByRole("button", { name: "Legyen rövidebb", exact: true })).toBeDisabled();
  await expect(page.getByTestId("letter-text")).toHaveText("Korábbi levél szövege.");
});

test("failed modification keeps the request and enables retry", async ({ page }) => {
  await page.route("**/api/orders/ui-test/regenerate", (route) => route.fulfill({ status: 503, json: { ok: false, error: { message: "Próbálja újra később." } } }));
  await order(page);
  await page.getByLabel("Saját módosítási kérés", { exact: true }).fill("A zárás legyen udvariasabb.");
  await page.getByRole("button", { name: "Saját kérés elküldése" }).click();
  await expect(page.getByRole("alert")).toContainText("Próbálja újra");
  await expect(page.getByLabel("Saját módosítási kérés", { exact: true })).toHaveValue("A zárás legyen udvariasabb.");
  await expect(page.getByTestId("letter-text")).toHaveText(letter);
});

test("waiting stays truthful after many polls and offers help", async ({ page }) => {
  await page.clock.install();
  let calls = 0;
  await page.route("**/api/orders/ui-test/result", (route) => { calls++; return route.fulfill({ json: { ok: true, data: { ...completed, aiStatus: "generating", generatedLetter: undefined } } }); });
  await page.goto("/sikeres-fizetes?order=ui-test#token=abcdefghijklmnopqrstuvwxyz123456");
  await expect(page.getByRole("heading", { name: "Rendelés állapota" })).toBeVisible();
  for (let i = 0; i < 13; i++) { const before = calls; await page.clock.runFor(15000); await expect.poll(() => calls).toBeGreaterThan(before); }
  await expect(page.getByText("Levél elkészítése és minőségellenőrzése", { exact: true })).toBeVisible();
  await expect(page.getByText(/Még nincs kész eredmény/)).toBeVisible();
  await expect(page.getByText("A levél megnyitható", { exact: true })).toHaveClass(/text-slate-400/);
});

test("exhausted modification allowance still allows manual editing", async ({ page }) => {
  await order(page, { ...completed, generationCount: 2 });
  await expect(page.getByRole("button", { name: "Legyen rövidebb", exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "Szerkesztés", exact: true })).toBeEnabled();
});

test("layout stays inside the viewport on form, review and long documents", async ({ page }) => {
  await review(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await order(page, { ...completed, generatedLetter: "ő".repeat(200) + "\n" + letter });
  const rect = await page.getByTestId("letter-text").boundingBox();
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  const toolbar = page.getByRole("button", { name: "Szerkesztés", exact: true });
  await expect(toolbar).toBeVisible();
});
