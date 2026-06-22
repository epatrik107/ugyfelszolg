# Ügyfélközpont

„Megírjuk Ön helyett a nehéz leveleket.”

Az **Ügyfélközpont** egy magyar nyelvű, fizetős levélíró MVP. A felhasználó leírja a problémáját, Stripe Checkouttal fizet, majd kizárólag igazolt sikeres fizetés után kap hivatalos, udvarias és határozott hangvételű levelet.

## 1. Mi ez a projekt?

- fizetős problémamegoldó levélíró szolgáltatás
- nem általános chatbot
- React + Vite frontend
- Cloudflare Workers backend
- Cloudflare D1 adatbázis
- opcionális Cloudflare KV rate limithez
- Stripe Checkout fizetés
- Számlázz.hu automatikus B2C e-számla
- Gemini (Google) alapú levélgenerálás és hibrid minőségellenőrzés

## 2. Architektúra

```mermaid
flowchart LR
  U["Felhasználó"] --> F["GitHub Pages frontend<br/>xn--gyfelszolgalat-fsb.hu"]
  F --> W["Cloudflare Worker API<br/>api.xn--gyfelszolgalat-fsb.hu"]
  W --> D1["Cloudflare D1"]
  W --> KV["Cloudflare KV"]
  W --> S["Stripe Checkout + Webhook"]
  W --> I["Számlázz.hu Számla Agent"]
  W --> O["Gemini API (Google)"]
  W --> R["Resend"]
```

### Ékezetes domain technikai alakja

A megvett domain ékezetes formában: `ügyfelszolgalat.hu`.

DNS-ben, GitHub Pages custom domain mezőben, Worker custom domainnél, CORS-ban és environment változókban a Punycode alakot használjuk:

```text
xn--gyfelszolgalat-fsb.hu
```

Az API technikai domainje:

```text
api.xn--gyfelszolgalat-fsb.hu
```

A böngészők ezt a felhasználónak megjeleníthetik ékezetes formában, de a konfigurációkban a Punycode alak stabilabb és a GitHub Pages IDN domainhez is ezt kéri.

## 3. Miért nem fut backend GitHub Pages-en?

A GitHub Pages statikus hosting. Nem alkalmas szerveroldali API-kulcsok, Stripe webhook-verifikáció, D1-hozzáférés vagy Gemini API-kulcs biztonságos kezelésére. Emiatt:

- frontend: GitHub Pages
- backend: Cloudflare Workers
- adatbázis: Cloudflare D1

## 4. GitHub Pages frontend deploy

1. A repository `Settings > Pages` részében engedélyezze a GitHub Actions alapú deployt.
2. Demó alatt saját domain nélkül a GitHub Pages cím: `https://epatrik107.github.io/ugyfelszolg/`.
3. Ha a domain delegálása elkészült, állítsa be a saját domaint: `xn--gyfelszolgalat-fsb.hu`, és a GitHub Variable értéket módosítsa `VITE_BASE_PATH=/` értékre.
4. A `.github/workflows/deploy-frontend.yml` buildeli a `frontend` workspace-et és publikálja a `frontend/dist` könyvtárat.
5. Állítsa be GitHub secretként:
   - `VITE_TURNSTILE_SITE_KEY`

## 5. Cloudflare Worker backend deploy

1. Lokális fejlesztéshez másolja a `worker/wrangler.toml.example` fájlt `worker/wrangler.toml` néven.
2. GitHub Actions deploynál a workflow a GitHub Variables alapján generálja a `worker/wrangler.toml` fájlt, ezért D1/KV azonosítót nem kell a repositoryba commitolni.
3. Állítsa be a Worker secretjeit Wranglerrel vagy GitHub Actionsből.
4. A `.github/workflows/deploy-worker.yml` typechecket, teszteket és deployt futtat.

## 6. Cloudflare D1 létrehozás

```bash
npx wrangler d1 create ugyfelkozpont
```

A kapott `database_id` kerüljön a `worker/wrangler.toml` fájlba.

## 7. D1 migráció futtatása

```bash
npx wrangler d1 migrations apply ugyfelkozpont --remote --config worker/wrangler.toml
```

Lokálisan:

```bash
npx wrangler d1 migrations apply ugyfelkozpont --local --config worker/wrangler.toml
```

## 8. Cloudflare KV opcionális rate limithez

```bash
npx wrangler kv namespace create RATE_LIMIT_KV
```

A létrejött namespace ID kerüljön a `worker/wrangler.toml` megfelelő bindingjába.

## 9. Stripe Checkout beállítás

- Alapcsomag, prémium és prémium plusz: egyszeri fizetés
- Pénznem: `HUF`
- A frontend csak `packageId`-t küld; az ár minden esetben szerveroldalon dől el.
- A checkout kizárólag magyarországi magánszemély számlázási adatokkal indítható.
- Cégnév, adószám, VAT ID, céges buyer type és kliensoldali ár API-szinten is tiltott.

## 10. Stripe webhook beállítás

Webhook endpoint:

```text
https://api.xn--gyfelszolgalat-fsb.hu/api/stripe/webhook
```

Kezelt események:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`
- `payment_intent.payment_failed`
- `charge.refunded`

## 11. Stripe webhook secret beállítás

A Stripe dashboardból másolja ki a signing secretet, majd állítsa be:

```bash
npx wrangler secret put STRIPE_WEBHOOK_SECRET --config worker/wrangler.toml
```

## 12. Apple Pay / Google Pay megjegyzés

A Stripe Checkout képes Apple Pay és Google Pay megjelenítésére, ha:

- a Stripe-fiókban engedélyezett
- a domain ellenőrzött
- a böngésző, eszköz és felhasználói konfiguráció támogatja

## 13. Gemini API kulcs beállítás

```bash
npx wrangler secret put GEMINI_API_KEY --config worker/wrangler.toml
```

Alap modell:

```text
GEMINI_MODEL=gemini-3.1-flash-lite
```

Opcionális review modell:

```text
GEMINI_REVIEW_MODEL=gemini-3.1-flash-lite
```

## 14. Turnstile beállítás

- frontend site key: `VITE_TURNSTILE_SITE_KEY`
- Worker secret: `TURNSTILE_SECRET_KEY`
- a tokeneket a Worker minden publikus beküldésnél újraellenőrzi

## 15. Saját domain beállítás GitHub Pageshez

- frontend domain: `xn--gyfelszolgalat-fsb.hu`
- DNS-ben a GitHub Pages által kért rekordokat kell beállítani
- a Pages felületen kapcsolja be a HTTPS-t

## 16. API subdomain beállítás Cloudflare Workerhöz

- API domain: `api.xn--gyfelszolgalat-fsb.hu`
- a Worker route vagy custom domain erre mutasson
- a `SITE_URL` értéke `https://xn--gyfelszolgalat-fsb.hu`

## 17. GitHub Actions secret beállítás

A Worker külön GitHub `sandbox` és `production` Environmentet használ, környezetenként elkülönített Stripe-, Számlázz.hu-, Cloudflare- és alkalmazás-secretekkel. A pontos secret- és variable-lista: [docs/github-environments.md](docs/github-environments.md).

Fontos: a Worker secret értékeket nem szabad frontend env változóba tenni. A deploy workflow a kiválasztott GitHub Environment secretjeiből szinkronizálja őket Cloudflare Worker secretként. A merge nem indít automatikus production deployt.

## 18. Lokális fejlesztés

A teljes Stripe + Számlázz.hu sandbox smoke teszt külön útmutatója: [docs/payment-test.md](docs/payment-test.md). A tesztkonfiguráció ellenőrzéséhez futtassa az `npm run test:payment-env` parancsot; ez nem ír ki secret értékeket.

```bash
npm install
```

Hozza létre a frontend helyi env fájlt:

```bash
cp .env.example frontend/.env.local
```

Minimum helyi frontend beállítás:

```env
VITE_API_BASE_URL=http://127.0.0.1:8787
VITE_SITE_URL=http://127.0.0.1:5173
VITE_TURNSTILE_SITE_KEY=
VITE_DEMO_MODE=true
```

Hozza létre a Worker configot:

```bash
cp worker/wrangler.toml.example worker/wrangler.toml
```

Hozza létre a `worker/.dev.vars` fájlt. Ez gitignore alatt van, ide kerülnek a helyi secret értékek:

```env
GEMINI_API_KEY=<google-ai-studio-key>
GEMINI_MODEL=gemini-3.1-flash-lite
GEMINI_REVIEW_MODEL=gemini-3.1-flash-lite
TOKEN_HASH_SECRET=hosszu-random-titok
SITE_URL=http://127.0.0.1:5173
ALLOWED_ORIGINS=http://127.0.0.1:5173
DEMO_MODE=true
DEMO_ACCESS_CODE=hosszu-egyszeri-demo-kod
PAYMENTS_ENABLED=false

# Ezek csak teljes Stripe/Turnstile/Resend flow teszteléshez kellenek:
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
SZAMLAZZ_AGENT_KEY= # csak Számlázz.hu tesztfiók kulcsa lokális smoke teszthez
TURNSTILE_SECRET_KEY=
RESEND_API_KEY=
EMAIL_FROM=Ügyfélközpont <noreply@example.com>
```

Lokális D1 migráció:

```bash
npx wrangler d1 migrations apply ugyfelkozpont --local --config worker/wrangler.toml
```

Indítás két terminálban:

```bash
npm run dev --workspace worker
```

```bash
npm run dev --workspace frontend
```

Frontend alapértelmezett címe:

```text
http://localhost:5173
```

Worker lokális címe:

```text
http://127.0.0.1:8787
```

### Demó mód fizetés nélkül

Teszteléshez állítsa be:

- Worker: `DEMO_MODE=true`
- Worker secret: `DEMO_ACCESS_CODE`
- Frontend: `VITE_DEMO_MODE=true`
- Worker: `PAYMENTS_ENABLED=false`

Ilyenkor a levélkészítő oldalon megjelenik a demó hozzáférési kód mező. A backend csak helyes kóddal hagyja ki a Stripe fizetést, szerveroldalon `paid` állapotú tesztrendelést hoz létre, majd elindítja a próba levélírást. Ezt éles környezetben csak átmeneti tesztre használja, erős, nem kitalálható kóddal.

Ha `PAYMENTS_ENABLED=false`, akkor a Stripe Checkout és a Stripe webhook útvonal szerveroldalon le van tiltva. Így a demó alatt nincs bankkártyás fizetés.

## GitHub Pages + Cloudflare Worker demó deploy

Ebben az állapotban a cél:

- frontend: GitHub Pages, például `https://xn--gyfelszolgalat-fsb.hu`
- backend: Cloudflare Worker, például `https://api.xn--gyfelszolgalat-fsb.hu`
- adatbázis: Cloudflare D1
- fizetés: kikapcsolva
- levélgenerálás: demó kóddal működik

### 1. GitHub repository

Pusholja a kódot a GitHub repositoryba:

```bash
git add .
git commit -m "Initial Ugyfelkozpont MVP"
git push origin main
```

### 2. Cloudflare D1

Hozzon létre D1 adatbázist:

```bash
npx wrangler d1 create ugyfelkozpont
```

Másolja a kapott `database_id` értéket a `worker/wrangler.toml` fájlba.

### 3. Cloudflare KV

Hozzon létre KV namespace-t rate limithez:

```bash
npx wrangler kv namespace create RATE_LIMIT_KV
```

Másolja a kapott `id` értéket a `worker/wrangler.toml` fájlba.

### 4. Worker config

Készítse el és commitolja a nem titkos Worker configot:

```bash
cp worker/wrangler.toml.example worker/wrangler.toml
```

A demóhoz ezek legyenek benne:

```toml
[vars]
GEMINI_MODEL = "gemini-3.1-flash-lite"
GEMINI_REVIEW_MODEL = "gemini-3.1-flash-lite"
SITE_URL = "https://xn--gyfelszolgalat-fsb.hu"
ALLOWED_ORIGINS = "https://xn--gyfelszolgalat-fsb.hu,https://epatrik107.github.io"
EMAIL_FROM = "Ügyfélközpont <noreply@xn--gyfelszolgalat-fsb.hu>"
DEMO_MODE = "true"
PAYMENTS_ENABLED = "false"
```

Ne tegyen API kulcsot a `wrangler.toml` fájlba.

### 5. Cloudflare Worker secrets

Demóhoz minimum:

```bash
npx wrangler secret put GEMINI_API_KEY --config worker/wrangler.toml
npx wrangler secret put TOKEN_HASH_SECRET --config worker/wrangler.toml
npx wrangler secret put DEMO_ACCESS_CODE --config worker/wrangler.toml
```

`TOKEN_HASH_SECRET` és `DEMO_ACCESS_CODE` legyen hosszú, random, nem kitalálható érték.

### 6. D1 migráció a felhőben

```bash
npx wrangler d1 migrations apply ugyfelkozpont --remote --config worker/wrangler.toml
```

### 7. Worker deploy

```bash
npx wrangler deploy --config worker/wrangler.toml
```

Ezután állítsa be a Cloudflare Worker custom domaint:

```text
api.xn--gyfelszolgalat-fsb.hu
```

### 8. GitHub Pages frontend

GitHub repositoryban:

1. `Settings > Pages`
2. Source: GitHub Actions
3. Demó alatt hagyja üresen a Custom domain mezőt, így az oldal itt fut: `https://epatrik107.github.io/ugyfelszolg/`
4. Ha a domain már aktív Cloudflare-ben, Custom domain: `xn--gyfelszolgalat-fsb.hu`
5. HTTPS bekapcsolása

GitHub repository secrets/vars:

- Secret: `VITE_TURNSTILE_SITE_KEY` üresen is maradhat demó alatt, ha nem használ Turnstile-t.
- Variable: `VITE_DEMO_MODE=true`
- Variable: `VITE_BASE_PATH=/ugyfelszolg/` demó alatt; saját domainnél `VITE_BASE_PATH=/`
- Variable: `VITE_API_BASE_URL=https://ugyfelkozpont-api.epatrik107.workers.dev`, amíg az `api.xn--gyfelszolgalat-fsb.hu` nincs Cloudflare-re kötve.

A `.github/workflows/deploy-frontend.yml` alapból a workers.dev API címet használja, de `VITE_API_BASE_URL` GitHub Variable értékkel átállítható `https://api.xn--gyfelszolgalat-fsb.hu` címre.

### 9. Domain DNS

Cloudflare DNS-ben:

- `xn--gyfelszolgalat-fsb.hu` mutasson GitHub Pages-re a GitHub által kért rekordokkal.
- `api.xn--gyfelszolgalat-fsb.hu` Cloudflare Worker custom domain legyen.

Ne tegye nyilvánossá a demó hozzáférési kódot. Attól, hogy valaki nem tudja a domaint, az még nem valódi védelem; a tényleges védelem a szerveroldali `DEMO_ACCESS_CODE`.

## API kulcsok és szolgáltatások

- **Gemini API key:** Google AI Studio-ból (aistudio.google.com) kell létrehozni. Csak Worker secretbe kerülhet: `GEMINI_API_KEY`.
- **Cloudflare API token:** GitHub Actions deployhoz kell. Jogosultság: Workers deploy, D1/KV hozzáférés az adott accounton.
- **Cloudflare Account ID:** Cloudflare dashboardból másolható.
- **CLOUDFLARE_D1_DATABASE_ID:** GitHub Variable, a `npx wrangler d1 create ugyfelkozpont` parancs kimenetéből.
- **CLOUDFLARE_KV_NAMESPACE_ID:** GitHub Variable, a `npx wrangler kv namespace create RATE_LIMIT_KV` parancs kimenetéből.
- **Turnstile site key:** publikus frontend kulcs, `VITE_TURNSTILE_SITE_KEY`.
- **Turnstile secret key:** backend ellenőrzéshez, `TURNSTILE_SECRET_KEY`.
- **Stripe secret key:** test vagy live mód szerint, `STRIPE_SECRET_KEY`.
- **Stripe webhook secret:** a webhook endpoint signing secretje, `STRIPE_WEBHOOK_SECRET`.
- **TOKEN_HASH_SECRET:** saját, hosszú random titok a result tokenek és magic linkek HMAC hash-eléséhez.
- **Resend API key:** tranzakciós e-mailekhez kell, `RESEND_API_KEY`.

## GitHub Actions környezetek

A `Deploy worker` workflow kézzel indítható `sandbox` vagy `production` célkörnyezettel. A két környezethez külön Worker, D1, KV és environment-szintű secretek szükségesek; részletek: [docs/github-environments.md](docs/github-environments.md).

Ha a Worker deploy ezt írja: `binding DB of type d1 must have a valid database_id specified`, akkor a `CLOUDFLARE_D1_DATABASE_ID` GitHub Variable hiányzik vagy nem a D1 UUID van benne. Az érték a `npx wrangler d1 create ugyfelkozpont` kimenetében található `database_id`, nem a `ugyfelkozpont` adatbázisnév.

## 19. Tesztfizetés Stripe test módban

1. Használjon test kulcsokat.
2. Hozzon létre teszt webhook endpointot.
3. Stripe CLI-val továbbítsa a webhookokat lokálisan.
4. Tesztelje:
   - sikeres fizetés
   - sikertelen fizetés
   - lejárt session
   - webhook retry
   - refund esemény

## 20. Biztonsági ellenőrző lista élesítés előtt

- [ ] Stripe live kulcsok beállítva
- [ ] Stripe webhook live endpoint beállítva
- [ ] Webhook signature működik
- [ ] Saját domain HTTPS alatt fut
- [ ] API CORS csak saját domainre enged
- [ ] Turnstile működik
- [ ] GEMINI_API_KEY csak Worker secretben van
- [ ] Stripe secret csak Worker secretben van
- [ ] frontend bundle nem tartalmaz secretet
- [ ] fizetés nélkül nem lehet generálni
- [ ] success URL kézi megnyitása nem ad levelet
- [ ] ár módosítása frontendben nem változtat szerveroldali áron
- [ ] ugyanaz a webhook event nem generál kétszer
- [ ] ugyanahhoz az orderhez nem lehet két levelet generálni
- [ ] result token nélkül nem lehet levelet lekérni
- [ ] ÁSZF ellenőrizve
- [ ] Adatkezelés ellenőrizve
- [ ] teszt rendelés végigmegy
- [ ] teszt sikertelen fizetés végigmegy
- [ ] teszt webhook retry nem duplikál

## Biztonsági alapelvek

- az ár fix szerveroldali mapből jön
- a `success_url` önmagában soha nem bizonyít fizetést
- generálás csak `paid` rendelésből indul
- a `resultToken` nyersen nem kerül adatbázisba
- Stripe event idempotencia külön táblában van
- érzékeny API válaszok `Cache-Control: no-store` fejléccel mennek
- nincs wildcard CORS

## GitHub Pages frontend biztonsági fejlécek

A GitHub Pages nem támogat repo-szintű egyedi HTTP válaszfejléceket, ezért a
frontend jelenleg a `frontend/index.html` CSP és referrer meta tagjeit használja.
Ha a frontendet később Cloudflare Pages, Cloudflare proxy vagy más CDN szolgálja
ki, ugyanezt HTTP fejlécként kell beállítani, kiegészítve legalább ezekkel:
`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(self)`.

Aktív CSP:

```text
default-src 'self';
script-src 'self' https://challenges.cloudflare.com;
style-src 'self';
frame-src https://challenges.cloudflare.com;
connect-src 'self' https://ugyfelkozpont-api.epatrik107.workers.dev https://challenges.cloudflare.com;
img-src 'self' data:;
object-src 'none';
base-uri 'none';
frame-ancestors 'none';
form-action 'self';
```

A Stripe Checkout jelenlegi integrációja top-level redirectet használ, nem HTML
form POST-ot, ezért Stripe origin nincs a `form-action` direktívában.

## Projektstruktúra

```text
/
  README.md
  .env.example
  package.json
  wrangler.toml.example
  /frontend
  /worker
  /.github/workflows
```

## Fontos jogi figyelmeztetés

> A szolgáltatás nem minősül jogi, pénzügyi vagy egészségügyi tanácsadásnak. Az elkészített szöveg kommunikációs segítség, amelyet az ügyfél saját felelősségére használ fel.
