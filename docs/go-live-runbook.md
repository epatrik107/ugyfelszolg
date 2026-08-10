# GO-live runbook

Ez a runbook értékek kiírása nélkül rögzíti a konfiguráció egyetlen ajánlott
forrását és a `GO` döntéshez szükséges sorrendet.

## 1. Jelenlegi konfigurációs állapot

| Hely | Állapot | Teendő |
|---|---|---|
| GitHub Environmentek | 2026-08-10-én értékmentesen auditálva; productionben mind a 8 secret és 24 variable név szerint teljes | külön sandbox Cloudflare- és Gemini-kulcs még hiányzik |
| GitHub `production` protection | protected-branch policy aktív; a `main` PR + `verify` check védelemmel rendelkezik | required reviewer még nincs, admin bypass továbbra is engedett |
| `.env.example` | tracked, placeholder-only, fájlon belüli duplikáció nincs | ez marad az összes név dokumentációs inventoryja |
| `frontend/.env` | gitignore-olt, `0600`; két nevet definiál | a kívánt lokális értékek átvitele után törlendő |
| `frontend/.env.local` | gitignore-olt, `0600`; ugyanazt a két nevet eltérően felülírja | ez legyen az egyetlen lokális frontend env fájl |
| `worker/.dev.vars` | gitignore-olt, `0600`; csak három lokális secret neve van benne | demo fejlesztéshez elég lehet, payment teszthez hiányos |
| `worker/wrangler.toml` | gitignore-olt lokális config; CI nem ezt használja | lokális fejlesztésre tartható, production forrása a workflow |
| `worker/wrangler.toml.example` | tracked kanonikus Worker példa | ezt kell másolni lokális Worker-confighoz |
| root `wrangler.toml.example` | eltérő, nem használt duplikátum volt | eltávolítva; egyetlen példa maradt |
| Jogi verziók | ÁSZF `1.3`, privacy `1.2`; GitHub production és sandbox értékek egyeznek | a publikált ÁSZF AAM-szövegét jogi/könyvelői review-val jóvá kell hagyni |
| Cloudflare erőforrások | az account, két Worker, külön production/sandbox D1 és KV Wrangler OAuth-val ellenőrizve; bindingok helyesek | GitHub Environment resource ID-k javítva, repository D1/KV duplikációk törölve |
| Számlázás/fizetés | Stripe live account és webhook, Számlázz.hu éles mód, NAV-kapcsolat és AAM státusz projektgazdai megerősítés alapján kész | sandbox és production E2E, AAM számlakép és refund/storno ellenőrzés kell |
| Production API domain | `api.xn--gyfelszolgalat-fsb.hu` aktív Worker Custom Domain; DNS és TLS rendben | `/api/health` 2026-08-10-én HTTP 503/degraded; az új kód és GitHub secretkészlet még nincs production Workerre deployolva |

Az azonos név `sandbox` és `production` Environmentben **nem káros
duplikáció**: ez a szükséges környezeti izoláció, és az értékeknek különbözniük
kell. A káros duplikáció az, amikor ugyanaz a név repository és Environment
szinten is létezik; ilyenkor a GitHub Environment-szintű érték shadowolja a
repository-szintűt.

## 2. Hitelesített GitHub név-audit

A 2026-08-10-i, értékmentes audit tényleges GitHub-állapota:

- productionben pontosan a 8 kötelező secret és a 24 kötelező variable jelen
  van; hiányzó, stale vagy productionben tiltott név nincs;
- a production `LEGAL_TERMS_VERSION=1.3`, az `EMAIL_FROM` a Resendben verifikált
  domainen van; a deploy és runtime guard az idegen sender domaint blokkolja;
- sandboxban a teljes variable-névlista megvan, és a korábban secretként tárolt
  `EMAIL_FROM`/`SELLER_*` adatok variable-ként kerültek át, a stale secret
  példányok törölve lettek;
- sandboxból még hiányzik a külön `CLOUDFLARE_API_TOKEN` és `GEMINI_API_KEY`.
  Emiatt a két repository-szintű fallback egyelőre megmaradt; ezek productionben
  az Environment-szintű értékek által shadowolt scope-duplikációk;
- a repository-szintű `CLOUDFLARE_ACCOUNT_ID` secret törölve lett, mert az
  azonosító mindkét Environmentben helyesen variable;
- a `main` branch védett: PR, zöld `verify`, stale review eldobása,
  conversation resolution, admin enforcement, force-push és törlés tiltás;
- a `production` Environment csak védett branchből deployolható; required
  reviewer még nincs és az admin bypass továbbra is engedett.
- a GitHub production Environmentből az új workflow atomikusan deployolja az
  összes secretet, és explicit törli a stale `DEMO_ACCESS_CODE`/`OPENAI_API_KEY`
  neveket; ez a production Workerre még nem futott le;
- Dependabot alert/security update, provider-alapú secret scanning és push
  protection 2026-07-18-án bekapcsolva; a CodeQL JavaScript/TypeScript default
  setup első futása elindult;
- a production Worker még a korábbi verziót futtatja; az új AAM, Resend
  sender-domain és dependency javításokat tartalmazó PR merge/deploy előtt áll.

Az aktuális állapot bármikor újraellenőrizhető:

```bash
npm run audit:github-config
```

Az audit a repository-scope-ot is hibának jelzi, és csak neveket kér le.
Secret- vagy variable-értéket nem ír ki.

### Új gépen vagy lejárt GitHub session esetén

1. A repository gyökerében futtasd:

   ```bash
   gh auth login -h github.com
   ```

2. Válaszd a GitHub.com, HTTPS és böngészős/device-flow hitelesítést. Olyan
   account kell, amely admin a `epatrik107/ugyfelszolg` repositoryn.

3. Ezután futtasd:

   ```bash
   npm run audit:github-config
   ```

   A parancs csak neveket kér le. Nem kéri le és nem írja ki a secretek vagy
   variable-ök értékét.

4. Az eredmény legyen minden Environmentnél:

   - hiányzó secretek: `none`;
   - nem várt/stale secretek: `none`;
   - hiányzó variable-ök: `none`;
   - nem várt/stale variable-ök: `none`;
   - repository+environment duplikáció: `none`;
   - productionben tiltott secret: `none`.

5. Ha ugyanaz a név repository- és Environment-szinten is létezik:

   - először írd be újra az ismert helyes értéket a megfelelő `sandbox` vagy
     `production` Environmentbe;
   - futtass sandbox deployt;
   - csak a sikeres deploy után töröld az azonos repository-szintű nevet;
   - secretet ne másolj issue-ba, parancssori argumentumba vagy logba.

6. A stale production demo secretet csak ellenőrzött target mellett, manuálisan
   töröld:

   ```bash
   npx wrangler secret delete DEMO_ACCESS_CODE --config worker/wrangler.toml
   ```

   Ezután a Worker secret-listában és a health/preflight ellenőrzésben se
   szerepelhet production demo-hozzáférés.

GitHub UI útvonal: **Repository → Settings → Environments → production/sandbox**.
Repository-szintű lista: **Settings → Secrets and variables → Actions**.

## 3. Egyetlen kanonikus GitHub-scope

### Production Environment secretek — pontosan 8

- `CLOUDFLARE_API_TOKEN`
- `GEMINI_API_KEY`
- `RESEND_API_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `SZAMLAZZ_AGENT_KEY`
- `TOKEN_HASH_SECRET`
- `TURNSTILE_SECRET_KEY`

Productionben ne legyen:

- `ADMIN_API_TOKEN`;
- `DEMO_ACCESS_CODE`;
- `CLOUDFLARE_ACCOUNT_ID` secretként — ez variable;
- Stripe publishable key — a jelenlegi Hosted Checkout flow nem használja.

### Production Environment variable-ök — pontosan 24

Worker/deploy:

- `ADMIN_API_ENABLED=false`
- `ALLOWED_ORIGINS=https://xn--gyfelszolgalat-fsb.hu`
- `API_HEALTH_URL=https://api.xn--gyfelszolgalat-fsb.hu/api/health`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_D1_DATABASE_ID`
- `CLOUDFLARE_KV_NAMESPACE_ID`
- `D1_DATABASE_NAME`
- `EMAIL_FROM`
- `GEMINI_MODEL=gemini-3.1-flash-lite`
- `GEMINI_MODEL_PREMIUM=gemini-3.5-flash`
- `GEMINI_REVIEW_MODEL=gemini-3.1-flash-lite`
- `LEGAL_TERMS_VERSION=1.3`
- `PRIVACY_POLICY_VERSION=1.2`
- `SELLER_ADDRESS`
- `SELLER_NAME`
- `SELLER_TAX_NUMBER`
- `SITE_URL=https://xn--gyfelszolgalat-fsb.hu`
- `TURNSTILE_EXPECTED_HOSTNAMES=xn--gyfelszolgalat-fsb.hu`
- `WORKER_NAME`

Frontend — ezek publikusak:

- `VITE_API_BASE_URL=https://api.xn--gyfelszolgalat-fsb.hu`
- `VITE_BASE_PATH=/`
- `VITE_DEMO_MODE=false`
- `VITE_SITE_URL=https://xn--gyfelszolgalat-fsb.hu`
- `VITE_TURNSTILE_SITE_KEY`

A `SELLER_*` és `EMAIL_FROM` értékeket a könyvelő/jogász által jóváhagyott
adatokkal add meg. A Cloudflare erőforrás-azonosítókat ne másold át sandboxból.

### Sandbox Environment

- ugyanaz a 8 secret **külön test/sandbox értékekkel**;
- ugyanaz a 19 Worker/deploy variable külön sandbox erőforrásokkal;
- `STRIPE_SECRET_KEY` kizárólag test key;
- külön Stripe test webhook secret;
- külön D1, KV, Worker, Turnstile és Gemini key;
- `ADMIN_API_TOKEN` csak akkor megengedett, ha
  `ADMIN_API_ENABLED=true`; ajánlott itt is `false`;
- `DEMO_ACCESS_CODE` nem kell, mert a deploy workflow payment sandboxot futtat
  `DEMO_MODE=false` beállítással.

### `github-pages` Environment

Itt ne legyen saját alkalmazás-secret vagy variable. A frontend build a
`production` Environmentből olvas, a `github-pages` job csak a Pages artifactot
publikálja.

## 4. Production GitHub Environment védelme

1. Nyisd meg: **Settings → Environments → production**.
2. Deployment branch/tag policy: csak a védett `main` branch vagy egy explicit
   release tag deployolhasson.
3. Kapcsold ki az admin bypass lehetőségét.
4. Ha van másik megbízható közreműködő, állíts be required reviewert.
5. Kapcsold be a `main` branch protectiont: PR, zöld quality check és tiltott
   force-push.
6. A `sandbox` Environmenthez is adj branch policyt, de productionnél lehet
   szigorúbb.

## 5. Cloudflare erőforrások

1. Hozz létre vagy azonosíts egy külön production Workert.
2. Hozz létre külön production D1 adatbázist, és a nevét/UUID-jét tedd a
   `D1_DATABASE_NAME` / `CLOUDFLARE_D1_DATABASE_ID` variable-be.
3. Hozz létre külön production KV namespace-t a rate limithez; az ID kerüljön
   a `CLOUDFLARE_KV_NAMESPACE_ID` variable-be.
4. Hozz létre least-privilege deploy tokent. Csak a szükséges Worker-, D1- és
   KV-erőforrásokat érhesse el; Global API Keyt ne használj.
5. A Workerhez add hozzá custom domainként:

   `api.xn--gyfelszolgalat-fsb.hu`

6. Ellenőrizd, hogy nincs ütköző CNAME, a tanúsítvány aktív, és a Worker kapja
   az összes `/api/*` kérést.
7. Production deploy után a workflow `workers_dev=false` beállítással publikál.
8. Hozz létre külön production Turnstile widgetet. Engedélyezett hostname csak:

   `xn--gyfelszolgalat-fsb.hu`

9. A site key a `VITE_TURNSTILE_SITE_KEY` public variable, a secret key a
   `TURNSTILE_SECRET_KEY` Environment secret.

## 6. Külső szolgáltatói kulcsok

### Gemini

1. A Git historyban talált korábbi kulcs visszavonását a projektgazda 2026-07-18-án megerősítette.
2. A billing/usage auditot a projektgazda 2026-07-18-án késznek jelezte.
3. Az új restricted production Auth key beállítását a projektgazda 2026-07-18-án megerősítette.
4. Állíts be budget- és quota-riasztást.
5. A jelenlegi stabil modellek:
   `gemini-3.1-flash-lite` és `gemini-3.5-flash`.

### Stripe

1. Workbench → Webhooks → Create event destination.
2. Endpoint:

   `https://api.xn--gyfelszolgalat-fsb.hu/api/stripe/webhook`

3. Csak ezeket az eseményeket add hozzá:

   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `payment_intent.payment_failed`
   - `checkout.session.expired`
   - `refund.created`
   - `refund.updated`
   - `refund.failed`
   - `charge.refunded`
   - `charge.dispute.created`
   - `charge.dispute.updated`
   - `charge.dispute.closed`

4. A live API key legyen `STRIPE_SECRET_KEY`; az endpoint saját signing secretje
   legyen `STRIPE_WEBHOOK_SECRET`. Test és live érték soha ne legyen azonos.
5. Kapcsold be a sikertelen webhook-delivery riasztást.

### Resend

1. Verifikáld a küldő domaint SPF/DKIM rekordokkal, és állíts DMARC-ot.
2. Hozz létre domainre korlátozott **Sending access** kulcsot.
3. A verified sender legyen az `EMAIL_FROM` variable.
4. Kapcsold be bounce/complaint monitoringot.

### Számlázz.hu

1. Hozz létre külön live Számla Agent kulcsot.
2. A könyvelő ellenőrizze az eladóadatokat, az ÁFA-kezelést, valamint a
   refund/sztornó/helyesbítő folyamatot.
3. A sandbox külön tesztfiókot és külön Agent kulcsot használjon.

## 7. Sandbox release gate

1. Futtasd lokálisan:

   ```bash
   npm ci
   npm run audit:github-config
   npm run lint
   npm test
   npm run test:payment-smoke
   npm run build
   ```

2. GitHub Actions → **Deploy worker** → `sandbox`.
3. A workflow-nak létre kell hoznia D1 bookmark artifactot, alkalmaznia kell a
   migrációkat, majd 200/`status=ok` health választ kell kapnia.
4. Sandboxban szintetikus adatokkal teszteld:

   - sikeres és sikertelen Stripe fizetés;
   - módosított kliensoldali ár;
   - hibás és ismételt webhook;
   - refund és dispute;
   - AI timeout, hibás válasz, túl hosszú prompt és prompt injection;
   - IDOR és rossz/lejárt capability;
   - Turnstile rossz hostname/action;
   - Resend hiba és invoice retry;
   - D1-kiesés és hibás env;
   - logok secret- és PII-mentessége.

5. Szándékosan hibás sandbox health-konfigurációval egyszer bizonyítsd az
   automatikus Worker rollbacket.
6. Külön tesztadatbázison gyakorold a D1 Time Travel restore-t. Production D1-en
   ne gyakorolj restore-t.

## 8. Production deploy

1. Készíts release commitot/taget, és legyen zöld minden CI check.
2. `npm run audit:github-config` legyen teljesen zöld.
3. Indítsd a **Deploy worker → production** workflow-t.
4. Ellenőrizd:

   - D1 bookmark artifact létrejött;
   - a remote listában jelenleg várakozó 0009, 0010, 0011 és 0012 migráció
     sorrendben alkalmazva;
   - custom API health 200 és `status=ok`;
   - HSTS, CSP, XFO, nosniff és referrer header jelen van;
   - workers.dev origin nincs production használatban;
   - Stripe webhook endpoint elérhető és nincs delivery backlog.

5. Csak ezután indítsd a **Deploy frontend** workflow-t.
6. A frontend jelenlegi GitHub Pages hostingja nem alkalmazza automatikusan a
   `_headers` fájlt. A custom domaint Cloudflare proxy/Pages vagy más
   headerképes edge mögé kell tenni, és ott kell beállítani a security
   headereket.
7. Ellenőrizd, hogy a production bundle csak a custom API origint tartalmazza.
8. Végezz kontrollált, kis összegű live E2E vásárlást saját tesztadatokkal,
   előre egyeztetett számla/refund eljárással. Ellenőrizd az egyszeri
   fulfillmentet, AI eredményt, e-mailt, számlát és webhookot.
9. Legalább 60 percig figyeld az 5xx, webhook, AI-költség, D1, Resend és invoice
   metrikákat.

## 9. `GO` acceptance criteria

`GO` csak akkor adható, ha mind teljesül:

- `npm run audit:github-config` zöld, nincs missing/stale/duplicate név;
- nincs repository-szintű shadowing;
- történeti Gemini-kulcs visszavonva és usage audit kész;
- production GitHub Environment védett;
- sandbox payment/AI/invoice/refund/dispute E2E zöld;
- rollback és D1 restore drill dokumentált;
- production custom API stabil 200/`status=ok`;
- frontend security headerek tényleges HTTP headerek;
- Stripe live webhook és kontrollált live E2E zöld;
- monitoring/alerting aktív;
- a Cloudflare Workers Logs aktív (production `head_sampling_rate = 0.1`, sandbox `1`), és van 5xx/health riasztási címzett;
- jogász/könyvelő jóváhagyta a `1.2` jogi dokumentumokat és seller adatokat;
- nincs nyitott Critical vagy pénzügyi/adatvédelmi High blocker.

Ha a live E2E még nem történt meg, a legjobb döntés `CONDITIONAL GO`, nem `GO`.
