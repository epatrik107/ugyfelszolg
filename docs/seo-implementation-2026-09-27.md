# SEO megvalósítás – 2026. szeptember 27.

## Cél és kiadási sorrend

Az első kiadás megszünteti a meglévő aloldalak indexelési akadályát. A React alkalmazás megmarad, de a hat indexelhető oldal fordításkor teljes HTML-t kap. A fizetési és hozzáférési oldalak üres, noindex HTML-vázból indulnak. Az ismeretlen címek valódi 404 választ adnak. Az alkalmazás tartalomjegyzéke, a HTML fejléce és a sitemap azonos SEO-regiszterre épül.

1. Típusellenőrzés, teljes Worker-tesztcsomag, frontend build és negatív SEO-tesztek.
2. Asztali és mobil böngészős ügyfélfolyamatok, HTTP/HTML és navigációs SEO-ellenőrzés.
3. Kötelező GitHub Quality ellenőrzés után összevonás a main ágba.
4. Meglévő frontend- és Worker-deploy munkafolyamatok futtatása. A Worker-változás kizárólag az összes API-válasz noindex fejlécét adja hozzá.
5. Cloudflare SEO-szabályok alkalmazása külön munkafolyamattal. A program kizárólag a saját, stabil `ref` azonosítójú szabályait hozza létre vagy módosítja; az egyéb biztonsági szabályokat megőrzi.
6. Az éles sitemap minden címének státusz-, H1-, canonical- és title-ellenőrzése; utility oldalak, ismeretlen URL, assetek, fejlécek és átirányítások ellenőrzése.

## Megvalósított technikai és tartalmi elemek

- T-01–T-06: SEO-regiszter, közös szolgáltatói adatok, build idejű renderelés, hidratálás, oldalankénti head, noindex, generált sitemap, CI-ellenőrzés, szigorúbb deployellenőrzés.
- T-08: főoldali cím és lépések, rendezett címsorok, 766 szavas főoldali tartalom, csomag- és GYIK-szekciók, árak és kapcsolat bővítése, navigáció akadálymentességi jelölései.
- T-09: meglévő oldalak belső linkelése; a levéltípusok egyelőre a megfelelő űrlapesetre vezetnek. Új landingre mutató link csak az adott oldal publikálásakor kerülhet be.
- T-10: Organization, WebSite, Service/OfferCatalog, BreadcrumbList és a látható GYIK-kel azonos FAQPage. Az árak és módosítási keretek a csomagkonstansból származnak.
- T-11–T-12: OG-kép, többrétegű ICO, Apple-ikon, PNG-logó; 640/1024/1600 px AVIF és WebP hero, megfelelő méretek, preload és magas betöltési prioritás. A legnagyobb AVIF körülbelül 20 KB.
- T-14: `/index.html`, az ismert route-ok záró perjeles és `.html` változatainak query-megőrző 301 szabályai.
- T-16/T-18: valódi 404 és űrlaplink; API noindex fejléc minden válaszstátuszon.
- T-19: a négy támogatott `eset` érték előválasztása hidratálás után; ismeretlen érték biztonságos alapállapotot hagy.

## Külső függőségek és következő kiadások

Ezek nem tekinthetők elkészültnek pusztán a kód kiadásával:

- T-07 / GSC: bejelentkezett tulajdonosi hozzáférés, property ellenőrzése vagy létrehozása, szükség esetén DNS-hitelesítés, sitemap beküldése és indexelés kérése. A tényleges indexelést a Google végzi; időpontja nem garantálható.
- C-01: a három első landing (`/panaszlevel`, `/reklamacio`, `/webaruhaz-reklamacio`) előtt a csatolt audit kulcsszó-validálást és jogi lektorálást ír elő. Ezek teljesítését nem igazoltuk. A következő kiadás közös sablonja: bevezető, ingyenes minta, ellenőrzőlista, gyakori hibák, csomagok, GYIK, kapcsolódó oldalak; 900–1400 egyedi szó, legalább három kontextuális bejövő link.
- M-01: valós GA4 azonosító, hozzájárulási és adatkezelési szöveg jóváhagyása, mindkét CSP-réteg együttes frissítése. Addig nincs új analitikai adatküldés. Kötelező ellenőrzés: hozzájárulás előtt nincs kérés, tokenmentes URL-ek, rendelésenként egy purchase.
- T-13: a fizetési oldalak késleltetett betöltése nem része ennek a kiadásnak; a helyi böngészős ellenőrzés során bizonytalan betöltés jelentkezett. A tartalmi HTML már JS nélkül elérhető.
- C-02/P2: további három landing és levélmintahub, a GSC valós megjelenései alapján rangsorolva.
- C-03/C-04/P3: lektorált útmutatók, hiteles szerzői adatok és Rólunk oldal; külső megjelenések külön, konkrét közzétételi felhatalmazással.
- A régi domain tulajdonjoga és átirányítása, AI-crawler irányelv, RUM és hosszabb távú teljesítményadatok külön döntést vagy mérést igényelnek.

## Ellenőrző parancsok

A repository gyökerében: `npm run lint`, `npm test`, `npm run build`, `npm run test:e2e --workspace frontend -- --workers=2`, `node scripts/check-migrations.mjs`, `npm audit --audit-level=moderate`.

A frontend mappában: `node --test scripts/verify-seo.test.mjs`.

Élesben: `node scripts/check-frontend-health.mjs` és a Cloudflare-szabályok után `node scripts/check-frontend-seo-edge.mjs`.

A későbbi legacy-takarításkor együtt távolítható el a `spa-redirect.js`, a `sessionStorage.redirect` kompatibilitás és a dokumentált régi CSP-hash. Jelen kiadás ezeket a gyorsítótárazott régi 404 oldalak miatt megtartja.
