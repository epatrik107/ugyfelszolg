# GitHub sandbox és production environmentek

A Worker deploy csak kézzel indítható a GitHub Actions felületéről. A `main` branch merge önmagában nem indít sem Worker-, sem frontend production deployt.

## Environmentek létrehozása

A repository `Settings > Environments` részében hozz létre két environmentet:

- `sandbox`
- `production`

A két environmentben azonos secretneveket használunk, de eltérő értékekkel. Így a workflow nem tud test és live kulcsot ugyanabból a secretből véletlenül összekeverni. A `production` environmenthez ajánlott required reviewert beállítani.

## Environment secretek

Mindkét environmentben külön add meg:

- `CLOUDFLARE_API_TOKEN`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `GEMINI_API_KEY`
- `TURNSTILE_SECRET_KEY`
- `TOKEN_HASH_SECRET`
- `SZAMLAZZ_AGENT_KEY`
- `RESEND_API_KEY`

`ADMIN_API_TOKEN` csak sandboxban szükséges, ha ott explicit
`ADMIN_API_ENABLED=true`. Productionben `ADMIN_API_ENABLED=false`, amíg az admin
felület nincs Cloudflare Access identity és MFA mögött.

`sandbox` értékek:

- `STRIPE_SECRET_KEY`: kizárólag `sk_test_…`
- `STRIPE_WEBHOOK_SECRET`: a sandbox endpoint `whsec_…` signing secretje
- `SZAMLAZZ_AGENT_KEY`: kizárólag külön Számlázz.hu tesztfiók kulcsa
- `RESEND_API_KEY`: kizárólag sandbox/test email küldésre használt kulcs
- a többi külső szolgáltatásnál is fejlesztői/test credential

`production` értékek:

- `STRIPE_SECRET_KEY`: kizárólag `sk_live_…`
- `STRIPE_WEBHOOK_SECRET`: a live endpoint külön `whsec_…` signing secretje
- `SZAMLAZZ_AGENT_KEY`: az éles számlázási fiók külön, ehhez a webshophoz létrehozott Agent kulcsa
- `RESEND_API_KEY`: éles tranzakciós email kulcs, sandbox kulccsal nem lehet azonos

A Stripe publishable key nem szükséges, mert a frontend Hosted Checkout URL-re irányít; Stripe secret soha nem kerül frontend változóba.

## Environment változók

Mindkét environmenthez külön változóként állítsd be:

- `CLOUDFLARE_D1_DATABASE_ID`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_KV_NAMESPACE_ID`
- `D1_DATABASE_NAME`
- `WORKER_NAME`
- `SITE_URL`
- `ALLOWED_ORIGINS`
- `EMAIL_FROM`
- `SELLER_NAME`
- `SELLER_ADDRESS`
- `SELLER_TAX_NUMBER`
- `API_HEALTH_URL`
- `TURNSTILE_EXPECTED_HOSTNAMES`
- `LEGAL_TERMS_VERSION`
- `PRIVACY_POLICY_VERSION`
- `ADMIN_API_ENABLED` (`false` productionben)
- opcionálisan a `GEMINI_MODEL`, `GEMINI_MODEL_PREMIUM`, `GEMINI_REVIEW_MODEL` értékeket

Jóváhagyott production szolgáltatói értékek:

- `EMAIL_FROM=Ügyfélszolgálat.hu <noreply@xn--gyfelszolgalat-fsb.hu>`
- `SELLER_NAME=Engelbrecht Zoltán egyéni vállalkozó`
- `SELLER_ADDRESS=2500 Esztergom, Bánomi út 4.`
- `SELLER_TAX_NUMBER=91250960-1-31`

A `production` Environment frontendhez használt publikus változói:

- `VITE_API_BASE_URL`
- `VITE_BASE_PATH`
- `VITE_SITE_URL`
- `VITE_TURNSTILE_SITE_KEY`
- `VITE_DEMO_MODE=false`

A frontend build a `production` Environment változóit olvassa, majd a GitHub Pages saját `github-pages` Environmentjén keresztül publikál. Stripe vagy Számlázz.hu secret nem kerülhet frontend változóba. A production workflow nem használ fallback értékeket; minden felsorolt frontend változót explicit be kell állítani.

A sandboxnak külön Worker, D1 és KV erőforrást kell használnia. A workflow csak olyan sandbox nevet fogad el, amely tartalmazza a `sandbox` vagy `test` szót, például:

- `WORKER_NAME=ugyfelkozpont-api-sandbox`
- `D1_DATABASE_NAME=ugyfelkozpont-sandbox`

A sandbox `SITE_URL` és `ALLOWED_ORIGINS` használhat külön HTTPS tesztoldalt, illetve helyi teszthez kizárólag `http://localhost:<port>` vagy `http://127.0.0.1:<port>` origint. Productionben minden URL-nek HTTPS-nek kell lennie.

Ne használd ugyanazt a D1 adatbázist vagy Worker nevet sandboxhoz és productionhöz.

## Deploy sorrend

1. GitHub `Actions > Deploy worker > Run workflow`.
2. Elsőként válaszd a `sandbox` environmentet.
3. Futtasd végig a Stripe test és Számlázz.hu tesztfiókos smoke teszteket.
4. Csak jóváhagyás után indíts külön `production` workflow-t.
5. A production Worker sikeres deployja után indítsd kézzel a `Deploy frontend` workflow-t.

A workflow minden futásnál lintet, teszteket és buildet futtat, D1 Time Travel
bookmarkot ment artifactként, majd alkalmazza a migrációkat. A Worker deploy után
kötelező health/security-header ellenőrzés fut; hiba esetén a workflow Wrangler
rollbacket indít és sikertelenül zár. A kulcsprefix-, webhook-mód-, custom domain-,
admin API- és Számlázz.hu tesztfiók-ellenőrzés deploy előtt leállítja a hibás
konfigurációt.

A teljes, érték nélküli inventory: `docs/production-secrets.md`.
