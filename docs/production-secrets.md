# Production secretek és environment konfiguráció

Ez a lista a tényleges implementáció és a production workflow alapján készült. Valódi értéket ne írj repositoryba, issue-ba, logba vagy frontend változóba.

## 1. Kötelező production secretek

Ezeket a GitHub repository `Settings → Environments → production → Environment secrets` részében kell felvenni. A workflow innen tölti őket a Cloudflare Worker secret store-ba.

| Név | Hol hozd létre | Cél és korlátozás | Rotáció |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare Dashboard → My Profile → API Tokens | Külön production deploy token, csak a szükséges account Worker/D1/KV erőforrásaira. Ne használj Global API Keyt. | Kiadás előtt scope review; kompromittálódáskor azonnal |
| `STRIPE_SECRET_KEY` | Stripe Workbench/Dashboard → Developers → API keys | **Live** szerveroldali key. A frontendbe soha. A kód a `live` mód/prefix egyezést ellenőrzi. | Kompromittálódáskor; külön test/live |
| `STRIPE_WEBHOOK_SECRET` | Stripe Workbench → Webhooks → production endpoint | Kizárólag a production webhook endpoint signing secretje. | Endpointcserekor vagy kompromittálódáskor |
| `GEMINI_API_KEY` | Google AI Studio / Google Cloud Console | Külön paid production projekt restricted Auth key-je, csak a Generative Language API-ra. A korábbi kulcs visszavonását és az új production kulcs beállítását a projektgazda 2026-07-18-án megerősítette. | Policy szerint; kompromittálódáskor azonnal |
| `TURNSTILE_SECRET_KEY` | Cloudflare Dashboard → Turnstile → production widget | Production widget Siteverify secretje; külön staging widget/secret szükséges. | Kompromittálódáskor; a Cloudflare rotation flow-val |
| `TOKEN_HASH_SECRET` | CSPRNG/password manager/secret manager | Legalább 32, inkább 48–64 random byte HMAC secret. Nem szolgáltatói kulcs. Cseréje az aktív result linkeket érvényteleníti. | Csak tervezetten vagy kompromittálódáskor |
| `RESEND_API_KEY` | Resend Dashboard → API Keys | Send-only production key a verifikált domainhez. | Kompromittálódáskor/periodikusan |
| `SZAMLAZZ_AGENT_KEY` | Számlázz.hu Vezérlőpult → Számla Agent Kulcsok | Külön live Agent kulcs ehhez az integrációhoz; kisbetűs formátumot vár a guard. | Kompromittálódáskor; külön test/live |

Hivatalos kezelési helyek: [Stripe API keys](https://docs.stripe.com/keys), [Gemini API key guide](https://ai.google.dev/gemini-api/docs/api-key), [Cloudflare Turnstile setup](https://developers.cloudflare.com/turnstile/get-started/), [Resend API keys](https://resend.com/docs/api-reference/api-keys/create-api-key).

### Productionben nem szükséges / ne add meg

- `ADMIN_API_TOKEN`: productionben az `ADMIN_API_ENABLED=false` kötelező; a statikus-tokenes admin API 404-et ad. Később Cloudflare Access identity/MFA integrációval váltható ki.
- `DEMO_ACCESS_CODE`: productionben tilos.
- Stripe publishable key: a jelenlegi Hosted Checkout flow nem használja.
- `DATABASE_URL`, DB user/password: D1 binding van, nem URL-es adatbázis-kapcsolat.
- JWT/session/OAuth secret: nincs ilyen auth flow.
- Redis/queue/object-storage key: nincs ilyen komponens.

## 2. Kötelező production GitHub Environment variables

Ezek nem secretek, de környezetfüggő és biztonságkritikus konfigurációk.

| Név | Production elvárt típusa/célja |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | A production Cloudflare account azonosítója; Environment variable, nem secret |
| `CLOUDFLARE_D1_DATABASE_ID` | A külön production D1 UUID-je |
| `CLOUDFLARE_KV_NAMESPACE_ID` | A külön production rate-limit KV namespace ID-ja |
| `D1_DATABASE_NAME` | Production D1 név; nem tartalmazhat `test`/`sandbox` szót |
| `WORKER_NAME` | Production Worker név; nem tartalmazhat `test`/`sandbox` szót |
| `API_HEALTH_URL` | `https://api.xn--gyfelszolgalat-fsb.hu/api/health` |
| `SITE_URL` | `https://xn--gyfelszolgalat-fsb.hu` |
| `ALLOWED_ORIGINS` | Csak a tényleges frontend origin, jellemzően `https://xn--gyfelszolgalat-fsb.hu` |
| `TURNSTILE_EXPECTED_HOSTNAMES` | Exact hostname scheme/path/wildcard nélkül: `xn--gyfelszolgalat-fsb.hu` |
| `LEGAL_TERMS_VERSION` | A `frontend/src/config/legalVersions.json` publikált ÁSZF-verziója; jelenlegi release-ben `1.2` |
| `PRIVACY_POLICY_VERSION` | A `frontend/src/config/legalVersions.json` publikált privacy-verziója; jelenlegi release-ben `1.2` |
| `ADMIN_API_ENABLED` | Kötelezően `false` productionben |
| `GEMINI_MODEL` | Explicit, támogatott standard model ID |
| `GEMINI_MODEL_PREMIUM` | Explicit, támogatott prémium model ID |
| `GEMINI_REVIEW_MODEL` | Explicit, támogatott review model ID |
| `EMAIL_FROM` | Resendben verifikált sender |
| `SELLER_NAME` | Könyvelő/jogász által jóváhagyott jogi eladónév |
| `SELLER_ADDRESS` | Jóváhagyott jogi cím |
| `SELLER_TAX_NUMBER` | Jóváhagyott adószám |

A workflow maga állítja: `DEMO_MODE=false`, `PAYMENTS_ENABLED=true`, `PAYMENT_MODE=live`, `SZAMLAZZ_TEST_ACCOUNT_CONFIRMED=false`.

## 3. Frontend production változók

Ezek **publikusak**, a böngésző bundle-ben láthatók; secret nem kerülhet közéjük.

| Név | Production érték/típus |
|---|---|
| `VITE_API_BASE_URL` | `https://api.xn--gyfelszolgalat-fsb.hu`; `workers.dev` címet a workflow már blokkol |
| `VITE_SITE_URL` | `https://xn--gyfelszolgalat-fsb.hu` |
| `VITE_BASE_PATH` | `/` custom domainnél |
| `VITE_TURNSTILE_SITE_KEY` | A production Turnstile widget **publikus** site key-je |
| `VITE_DEMO_MODE` | `false` |

## 4. Kötelező külső erőforrások

- Külön production Cloudflare Worker, D1, KV és működő custom API domain.
- Headerképes frontend edge/proxy: a repository `frontend/public/_headers` policyja Cloudflare Pages/Workers alatt használható, a jelenlegi GitHub Pages válasz viszont nem alkalmazza automatikusan; HSTS/CSP/XFO/nosniff/referrer headereket az edge-en kell igazolni.
- Stripe live webhook: `https://api.xn--gyfelszolgalat-fsb.hu/api/stripe/webhook`.
- Stripe események: checkout completed/expired/async failed, payment failed,
  `refund.created`, `refund.updated`, `refund.failed`, `charge.refunded`, valamint
  dispute created/updated/closed.
- Google paid production project, billing, budget/quota alert, restricted Auth key és dokumentált prompt logging policy.
- Cloudflare Turnstile production widget csak a production hostname-ra; külön staging widget.
- Resend verified domain, SPF/DKIM/DMARC és send-only key.
- Számlázz.hu live account/Agent kulcs, könyvelő által ellenőrzött seller/ÁFA/refund folyamat.
- GitHub `production` Environment required reviewerrel.
- Cloudflare D1 Time Travel elérhetőség; a workflow minden migráció előtt bookmark artifactot készít.

## 5. Induláskori és deploy-validáció

- A Worker health `503 degraded` választ ad, ha DB, AI key, token secret, URL-ek, legal verziók, Turnstile hostname/secret/KV vagy payment provider beállítás hiányzik.
- Live módban a Stripe test key, HTTP origin, Számlázz.hu tesztflag és admin API engedélyezés blokkolt.
- A deploy csak custom API health URL-t fogad el, productionben `workers_dev=false`.
- A Worker deploy után a workflow 200/`status=ok` választ és security headereket vár; hiba esetén automatikus Worker rollbacket indít.
- A frontend deploy blokkolja a `workers.dev` API origint és a `github.io` canonical site URL-t.

## 6. Patrik release előtti ellenőrzőlistája

- [x] Régi, Git-historyban talált Gemini kulcs visszavonva, usage auditálva és új production kulcs beállítva — projektgazda által megerősítve 2026-07-18-án
- [ ] Minden fenti production secret létrehozva, stagingtől elkülönítve
- [ ] Minden fenti GitHub variable beállítva
- [ ] Custom API `/api/health` 200/ok
- [ ] Frontend edge-en HSTS/CSP/XFO/nosniff/referrer headerek ténylegesen jelen vannak
- [ ] Stripe webhook dashboard zöld, test/live kulcsok külön
- [ ] Turnstile idegen hostname/action tesztje blokkolt
- [ ] D1 bookmark artifact és rollback stagingen kipróbálva
- [ ] ÁSZF/privacy verzió és seller adatok jogász/könyvelő által jóváhagyva
- [ ] Resend domain és bounce/complaint monitoring működik
- [ ] Teljes staging payment/AI/invoice/refund/dispute teszt sikeres
