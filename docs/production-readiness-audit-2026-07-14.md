# Production security és readiness audit

Audit dátuma: 2026-07-14
Utolsó technikai frissítés: 2026-07-17
Külső konfigurációs státusz frissítése: 2026-08-10
Auditált projekt: `ugyfelszolg`
Módszer: forráskód-, konfiguráció-, Git-előzmény-, függőség-, build-, teszt- és nem destruktív élő endpoint-vizsgálat. Valódi fizetés, ügyféladat-módosítás és production migráció nem történt. Secretérték nem szerepel ebben a jelentésben.

## 1. Executive summary

### Javítási kör státusza — 2026-07-14

Az alábbi részletes findingok megőrzik az eredeti audit-snapshotot; ez a blokk mutatja az utána elvégzett javítások aktuális állapotát.

- **Kódban lezárva:** a production admin API alapértelmezetten és a deploy guard által is tiltott; a result capability query helyett URL fragmentben érkezik és azonnal törlődik; Stripe/Turnstile timeout és provider/action/hostname validáció készült; a prompt mezők escape-eltek; a rekurzív inputvizsgálat mélység- és elemszámkorlátot kapott; a jogi elfogadás ideje és dokumentumverziói additív D1 migrációval tárolódnak.
- **Deploymentben implementálva, de még nem bizonyított production runnal:** D1 Time Travel bookmark artifact, strict Worker deploy, kötelező custom-domain health/security-header gate, automatikus Worker rollback, production `workers_dev=false`, valamint a frontend `workers.dev` originjének tiltása.
- **Ellenőrizve:** 29 tesztfájl / 322 teszt, 66 payment smoke teszt, lint/typecheck, production build, 0001–0012 migráció üres SQLite-on és workflow YAML — sikeres. Az offline npm advisory cache 0 találatot adott; a friss online `npm audit` a lejárt helyi hitelesítés/hálózati korlát miatt nem volt megismételhető, ezért release előtt CI-ben kötelező.
- **2026-07-17-i kódjavítások:** a Stripe refund külön életciklus-auditot kapott; pending/failed refund többé nem állítja hamisan `refunded` állapotba a rendelést és nem küld sikeres refund emailt. A cron feladatok hibaszigeteltek, az FK-függő auditrekordok törlése megelőzi a rendeléstörlést, a KV rate-limit kulcsok HMAC-oltak, a production deploy csak `main` ágról indítható, és a frontend a csomagspecifikus regenerációs limitet mutatja.
- **Továbbra is külső P0 blocker:** a custom domain/DNS/TLS útvonal helyreállt és a korábbi 522 megszűnt, de az élő custom API health még HTTP 503/degraded a hiányzó runtime konfiguráció miatt; az új workflow még nincs stagingen/productionben lefuttatva és rollback/restore drill sem történt. A történeti Gemini-kulcs visszavonását és usage auditját a projektgazda 2026-07-18-án késznek jelezte. Az új `GEMINI_API_KEY` név jelenlétét a production GitHub Environmentben és a Cloudflare Workerben az audit 2026-07-18-án függetlenül igazolta, az értékét nem olvasta ki.
- **2026-07-18-i külső állapot:** a production GitHub variable-névlista teljes; a production Environmentből és a Workerből a két szándékosan hiányzó Stripe secret mellett a `SZAMLAZZ_AGENT_KEY` hiányzik. A Workerben stale `DEMO_ACCESS_CODE` maradt, amelyet kézzel kell törölni. A remote D1-en a 0009–0012 migrációk még nem alkalmazottak. Dependabot alert/security update, secret scanning és push protection bekapcsolva; a CodeQL első elemzése elindult.
- **2026-08-10-i projektgazdai megerősítés és kódremediáció:** a Stripe live kulcs és webhook secret, a rotált Számlázz.hu Agent kulcs és a többi dokumentált production secret bekerült a GitHub production Environmentbe; a Stripe account és webhook, a Számlázz.hu éles mód és NAV-kapcsolat elkészült. A projektgazda AAM adózási státuszt erősített meg. A korábbi 27%-os számlabontás eltávolításra került: az Agent XML `AAM` kódot, nettó=bruttó és áfa=0 értékeket használ. Ezeket production deploy és valódi számla nélkül, mockolt tesztekkel kell újraellenőrizni; a Cloudflare runtime szinkron és a staging/rollback bizonyíték továbbra is release gate.
- **2026-08-10-i dependency és konfiguráció-ellenőrzés:** React Router, PostCSS/Nanoid, Hono és Wrangler azonos majoron belüli javított verzióra frissült. A friss online `npm audit --audit-level=low` 0 ismert sérülékenységet jelzett; a teljes typecheck, 29 tesztfájl / 325 teszt és production build sikeres. A Resend `EMAIL_FROM` a verifikált domainre javítva, a deploy/runtime guard az eltérő sender domaint blokkolja. A production és sandbox GitHub Environment secret-/variable-névlistája teljes, a repository scope üres. Izolált Számlázz.hu tesztfiók hiányában a sandbox payment provider secretek eltávolítva, a deploy `PAYMENTS_ENABLED=false` értéket kényszerít; a sandbox deploy és a production deploy/health még nyitott release gate.

A production secret és variable beállítások aktuális, rövidebb operációs listája: `docs/production-secrets.md`.

**Végső állapot: `NO-GO`.**

A payment üzleti logikája az átlagos korai fázisú alkalmazásokhoz képest kifejezetten jól védett: az ár és csomag szerveroldali, a Stripe webhook aláírás-ellenőrzött és idempotens, a teljesítés nem redirect vagy frontend state alapján történik, az összeg/pénznem/session/e-mail egyezés ellenőrzött, és a refund/chargeback állapotok nem hagynak aktív hozzáférést. Az AI-kulcs csak a Workerben használatos, a generálás fizetett rendeléshez és csomagkvótához kötött, időkorlátos és utóellenőrzött. SQL injectiont, parancsinjektálást, közvetlen kliensoldali secretet, insecure deserializációt vagy ismert sérülékeny npm csomagot nem találtam.

A kiadás még nem biztonságos/stabil:

- A custom API kezdeti `522` hibáját a hibás, proxizott `workers.dev` CNAME eltávolítása és a Worker Custom Domain bekötése megszüntette. A custom endpoint most elérhető, TLS-valid, de `503 degraded`, mert a production runtime secretkészlet még hiányos. A jelenlegi publikus frontend bundle továbbra is a degradált `workers.dev` originre mutat.
- A Git-előzményben továbbra is látható egy Gemini/Google API-kulcs formátumú korábbi érték. A projektgazda 2026-07-18-án megerősítette, hogy a régi kulcs visszavonása, a usage audit és az új production kulcs beállítása elkészült. A history scan ezért továbbra is jelezni fog, de a credential operációs státusza felhasználói megerősítés alapján lezárt.
- A javított workflow már készít Time Travel bookmarkot, health gate-et és automatikus rollbacket, de ezt még tényleges Cloudflare staging/production futás és restore drill nem bizonyítja.
- A statikus bearer-tokenes admin API productionben most fail-closed módon tiltott. Újra csak identity-aware Access/MFA bevezetése és auditálható actor után engedhető be.

Az eredeti snapshot összesítése **0 Critical, 4 High, 15 Medium, 5 Low, 3 Informational** finding volt. H-02 felhasználói megerősítés alapján lezárt; H-03 és H-04 kódszintű remediációja elkészült, de deploy/drill bizonyíték híján még nem zárhatók le operációsan; H-01 nyitott. A `NO-GO` legalább a fennmaradó P0 acceptance criteria teljesüléséig marad.

## 2. A rendszer architektúrájának rövid leírása

### Technológiai térkép

| Réteg | Implementáció | Helye |
|---|---|---|
| Frontend | React 19, React Router 7, TypeScript, Vite 6, Tailwind CSS | `frontend/` |
| Backend/API | Hono, TypeScript, Cloudflare Workers | `worker/src/` |
| Adatbázis | Cloudflare D1 / SQLite, paraméterezett SQL, 12 migráció | `worker/migrations/`, `worker/src/lib/db.ts` |
| Rate limit store | Cloudflare KV binding | `worker/src/lib/rateLimit.ts` |
| AI | Google Gemini REST API; standard/prémium/review modell külön konfigurálható | `worker/src/lib/ai.ts`, `worker/src/lib/geminiModels.ts` |
| Fizetés | Stripe Hosted Checkout, egyszeri kártyás fizetés | `worker/src/lib/stripe.ts`, `worker/src/routes/stripeWebhook.ts` |
| Számlázás | Számlázz.hu Számla Agent | `worker/src/lib/szamlazz.ts`, `worker/src/lib/invoice.ts` |
| E-mail | Resend REST API | `worker/src/lib/email.ts` |
| Botvédelem | Cloudflare Turnstile | frontend + `worker/src/lib/turnstile.ts` |
| Frontend deploy | GitHub Pages, manuális GitHub Actions workflow | `.github/workflows/deploy-frontend.yml` |
| Backend deploy | Cloudflare Worker, manuális sandbox/production workflow | `.github/workflows/deploy-worker.yml` |
| CI | npm ci, typecheck, tesztek, payment smoke, build, egyszerű secret regex | `.github/workflows/quality.yml` |

Nincs Dockerfile, Kubernetes/Terraform/Pulumi konfiguráció, object storage, Redis/queue, OAuth, külön felhasználói jelszó vagy cookie-session. Konténer-root, image healthcheck és image scan ezért jelenleg nem alkalmazható. A Cloudflare Worker graceful lifecycle-ját a platform kezeli; az aszinkron mellékhatások `waitUntil` segítségével futnak.

### Tényleges adatfolyam

1. A böngésző elküldi az űrlap- és számlázási adatokat, a Turnstile tokent és egy idempotency UUID-t a Workernek.
2. A Worker strict Zod validációt, manipulált ár/adó mező detektálást, Turnstile- és rate-limit ellenőrzést végez. A csomag ára a szerverkatalógusból származik (`worker/src/lib/packages.ts:16-59`).
3. A Worker D1 rendelést hoz létre, majd Stripe Hosted Checkout sessiont készít a saját összegével. A kártyaadat nem érinti ezt az alkalmazást.
4. A Stripe webhook nyers body HMAC-aláírása ellenőrzött. A Worker az esemény feldolgozása előtt lekéri a sessiont a Stripe-tól, majd ellenőrzi az order/session/package/amount/currency/e-mail összefüggést (`worker/src/routes/stripeWebhook.ts:52-147`).
5. Csak sikeres, pontosan egyező webhook után lesz a rendelés fizetett. Ez indítja az AI-generálást és az idempotens számlázási pipeline-t.
6. Az eredményhez egy nagy entrópiájú capability bearer token tartozik; D1-ben csak HMAC-hash tárolódik. A token a Stripe success/cancel URL fragmentjében érkezik, majd a frontend `sessionStorage`-ba helyezi és azonnal eltávolítja a látható URL-ből. Legacy query token csak kompatibilitási bemenetként kerül elfogadásra és ugyanígy törlődik.
7. A napi cron (`17 2 * * *`) adatretenciót, számla retry-kat és elakadt AI-generálás utáni refundot kezel (`worker/src/index.ts:127-139`).

### Authentication és authorization

- Nincs általános felhasználói account/login. Az egyes rendelésekhez való hozzáférés capability tokennel történik; a privát order endpointok ezt szerveroldalon ellenőrzik.
- Az admin számla endpointok csak `ADMIN_API_ENABLED=true` esetén léteznek logikailag; production deploy ezt az állapotot tiltja, ezért alaphelyzetben 404-et adnak. Sandboxban engedélyezve továbbra is statikus `ADMIN_API_TOKEN` bearert használnak, ezért éles engedélyezés előtt identity-aware Access/MFA szükséges.
- Cookie nincs, ezért `HttpOnly`/`Secure`/`SameSite`, CSRF és jelszóhash-elés a jelenlegi architektúrában nem alkalmazható. A CORS önmagában nem auth kontroll; a tényleges védelmet a capability/admin token adja.
- A D1-ben létező subscription/magic-link táblák és függvények jelenleg nem alkotnak publikus login- vagy aktív előfizetési flow-t. Minden aktív csomag egyszeri fizetés (`billingMode: payment`).

### Környezetek és infrastruktúra

A workflow külön `sandbox` és `production` GitHub Environmentet tud használni, külön Worker/D1/KV nevekkel. Ugyanakkor külön staging frontend/domain és igazolt end-to-end staging még nincs bizonyítva. A javított production Worker-konfiguráció `workers_dev = false` értéket generál, a sandbox viszont megtartja a preview origint.

## 3. Talált problémák severity szerint

### Critical

Nem találtam bizonyított, jelenleg kihasználható Critical hibát. Ez nem változtat a `NO-GO` döntésen: több nyitott P0/High tétel és egy igazolt production outage áll fenn.

### High

#### H-01 — Az éles backend nem egészséges és a frontend hibás originre mutat

- **Severity / blocker:** High; **igen, production blocker**.
- **Érintett hely:** élő `https://api.xn--gyfelszolgalat-fsb.hu/api/health`; élő `https://ugyfelkozpont-api.epatrik107.workers.dev/api/health`; `.github/workflows/deploy-frontend.yml:27-80`; `worker/src/index.ts:49-59`.
- **Technikai magyarázat:** a kezdeti custom API `522` hibát a Cloudflare Custom Domain helyreállítása megszüntette; az endpoint most TLS-valid, de `503 degraded` a hiányzó production runtime konfiguráció miatt. A publikus frontend JS még a workers.dev originre hivatkozik.
- **Forgatókönyv:** a felhasználó elküldi az űrlapot, de checkout/session vagy contact kérés nem működik; a Stripe redirect utáni result polling is hibára fut.
- **Üzleti hatás:** bevételkiesés, fizetés utáni rossz felhasználói élmény, support- és refundkockázat.
- **Javítás:** Cloudflare production env/binding/secrets és custom domain route ellenőrzése; `/api/health` 200; frontend `VITE_API_BASE_URL` átállítása a custom API domainre; Worker deploy után kötelező smoke gate.
- **Szükséges teszt:** health 200 mind custom domainen, mind a tényleges frontend originről; valid checkout sandboxban; success result polling; hibás origin buildet a CI blokkolja.

#### H-02 — Történeti Gemini/Google API-kulcs formátumú érték a Git-előzményben

**Remediációs státusz:** lezárva a projektgazda 2026-07-18-i megerősítése alapján: a régi kulcs visszavonva, usage auditálva, az új production kulcs beállítva. A státusz nem független auditbizonyítékból származik.

- **Severity / blocker:** High; **igen, amíg a visszavonás nem igazolt**.
- **Érintett hely:** Git commit `6036c08`, történeti `worker/test/aiReviewGate.test.ts:48`. A tényleges érték szándékosan nincs dokumentálva.
- **Technikai magyarázat:** a history scan egy Google API-kulcs formátumú karakterláncot talált. Az aktuális lokális kulcs nem egyezik vele, de formátum alapján nem bizonyítható, hogy mindig dummy volt.
- **Forgatókönyv:** ha a régi kulcs aktív vagy valaha aktív volt, a repository hozzáférője közvetlen Gemini API-hívásokkal költséget és adatvédelmi incidenst okozhat.
- **Üzleti hatás:** váratlan AI-költség, kvótakimerülés, incidens- és értesítési kötelezettség.
- **Javítás:** Google AI Studio/Cloud Console oldalon revoke; usage/audit log ellenőrzés; új, API-ra és szükséges projektre korlátozott Auth key; budget/quota alert; history tisztítása csak koordinált, force-push kockázatértékelés után. A Google jelenlegi kulcskezelési útmutatója restricted Auth key használatát írja le, és 2026-ban kivezeti a nem korlátozott standard kulcsokat: [Gemini API key guide](https://ai.google.dev/gemini-api/docs/api-key).
- **Szükséges teszt:** régi kulccsal egy ártalmatlan metadata kérés 401/403; új kulcs csak a kiválasztott API/projekt számára működik; secret scanner historyn nem jelez valódi kulcsot.

#### H-03 — A deploymentből hiányzik a post-deploy gate és a biztonságos adatbázis-visszaállítási pont

**Remediációs státusz:** kódban javítva (`.github/workflows/deploy-worker.yml`, `scripts/check-deployment-health.mjs`), operációsan nyitott az első sikeres staging deploy, automatikus rollback és D1 restore drill bizonyítékáig.

- **Severity / blocker:** High; **igen, production blocker**.
- **Érintett hely:** `.github/workflows/deploy-worker.yml:319-329`.
- **Technikai magyarázat:** remote D1 migráció fut a Worker deploy előtt; nincs előtte Time Travel bookmark/export, utána health/checkout smoke, illetve automatikus vagy dokumentált Worker-version rollback. A jelenlegi éles `503/522` átjutott ezen a folyamaton.
- **Forgatókönyv:** inkompatibilis migráció vagy hibás secret/binding után a régi és az új Worker egyaránt használhatatlan adatbázis-sémát kap; a pipeline mégis sikeresként zárhat.
- **Üzleti hatás:** leállás, fizetési webhook elvesztés/késés, adatinkonzisztencia, hosszú MTTR.
- **Javítás:** pre-deploy D1 Time Travel bookmark és migrációs dry-run; először Worker canary/staging; kötelező `/api/health` és sandbox smoke; előző Worker version azonosító rögzítése; forward-compatible expand/contract migrációk. A D1 Time Travel és backup képességeit a [Cloudflare D1 backup dokumentáció](https://developers.cloudflare.com/d1/reference/backups/) írja le.
- **Szükséges teszt:** szándékosan hibás env esetén a workflow bukik; korábbi Worker version visszaáll; staging D1 visszaállítás próbája és `foreign_key_check`/`integrity_check` sikeres.

#### H-04 — A PII- és számlaműveletek admin API-ja egyetlen statikus bearer tokenre támaszkodik

**Remediációs státusz:** productionben fail-closed módon letiltva (`ADMIN_API_ENABLED=false` kötelező; route 404). A finding csak akkor nyílik újra éles felületként, ha ezt identity-aware Access/MFA nélkül engedélyezik.

- **Severity / blocker:** High; **igen, vagy az endpointok ideiglenes letiltása szükséges**.
- **Érintett hely:** `worker/src/routes/adminInvoice.ts:17-35,38-85`; `worker/src/index.ts:46-48`.
- **Technikai magyarázat:** a legalább 32 karakteres token constant-time ellenőrzött és rate-limitált, de nincs személyhez kötött identity, MFA, lejárat, scope, revocation list vagy access proxy. A válasz számlázási címet, adószámot, e-mailt és payment azonosítókat ad vissza.
- **Forgatókönyv:** egy CI/log/shell/browser history útján kiszivárgott tokennel bárki rendelési PII-t kérdezhet le és invoice retry műveletet indíthat.
- **Üzleti hatás:** adatvédelmi incidens, hibás ügyviteli művelet, auditálhatatlanság.
- **Javítás:** Cloudflare Access + emberi identity/MFA és külön service token; admin útvonal csak custom domainen; `workers.dev` tiltása; rövid életű/rotálható credential; actorral ellátott audit log. Átmenetileg az admin route-ok ne legyenek regisztrálva productionben, ha nincs Access.
- **Szükséges teszt:** anonymous és régi token 401/403; Access nélküli workers.dev hozzáférés tiltott; két külön admin actor megkülönböztethető audit logban; retry továbbra is idempotens.

### Medium

#### M-01 — Rendelési bearer token URL queryben és sessionStorage-ban

**Remediációs státusz:** részben javítva; az új linkek fragmentet használnak, az oldal `no-referrer`, és böngészős teszt igazolta az azonnali URL-törlést. Token TTL/revocation és single-use exchange továbbra is P1 hardening.

- **Severity / blocker:** Medium; nem önálló P0, de P1.
- **Érintett hely:** `worker/src/lib/stripe.ts:115-119`; `worker/src/routes/getOrderResult.ts:10-32`; `frontend/src/pages/SuccessPage.tsx:95-118`; `frontend/src/pages/CancelPage.tsx:5-26`; `worker/src/lib/email.ts:190-205`.
- **Technikai magyarázat:** a capability token a Stripe success/cancel URL-ben és e-mail linkben szerepel. A React effect eltávolítja, de előtte böngésző history/CDN/request telemetry felületre kerülhet; nincs token TTL vagy egyedi revocation/version.
- **Forgatókönyv:** megosztott eszköz, support screenshot, proxy/CDN log vagy böngésző extension megszerzi a linket, majd elolvassa vagy újragenerálja az adott rendelés levelét.
- **Üzleti hatás:** egy rendelés PII-jének és generált tartalmának jogosulatlan elérése.
- **Javítás:** rövid életű, egyszer használatos exchange code a redirectben; csere után header-only capability; token expiry/revocation; a query eltávolítása már inline bootstrapban; result oldalon `no-referrer`.
- **Teszt:** exchange code második felhasználása sikertelen; lejárt/revokált token 401; URL/history/referrer nem tartalmaz capabilityt.

#### M-02 — A GitHub Pages frontendből hiányoznak a valódi HTTP security headerek

- **Severity / blocker:** Medium; P1.
- **Érintett hely:** élő frontend response; `frontend/index.html:10-14`; `.github/workflows/deploy-frontend.yml:81-93`.
- **Technikai magyarázat:** az élő HTTPS válaszban nem volt HSTS, CSP vagy X-Frame-Options. A meta CSP részleges; a `frame-ancestors` nem helyettesíti a HTTP headert. GitHub Pages támogatja az HTTPS enforcementet, de a GitHub külön figyelmeztet arra, hogy Pages nem érzékeny tranzakciókra készült: [GitHub Pages HTTPS](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https).
- **Forgatókönyv:** clickjacking vagy egy későbbi dependency/XSS hiba hatása nagyobb; tokenes result URL védelme gyengébb.
- **Üzleti hatás:** PII és rendelési capability expozíció, bizalmi és compliance kockázat.
- **Javítás:** headerképes hosting/edge (például Cloudflare Pages/Proxy); CSP header nonce/hash stratégiával, HSTS, `frame-ancestors 'none'`, XFO, Referrer-Policy, Permissions-Policy.
- **Teszt:** curl/browser ellenőrzés minden route-on; CSP report-only próba, majd enforcement; clickjacking PoC blokkolt.

#### M-03 — A KV rate limiter nem atomi és elosztott bursttel megkerülhető

- **Severity / blocker:** Medium; P1.
- **Érintett hely:** `worker/src/lib/rateLimit.ts:40-70`.
- **Technikai magyarázat:** külön KV `get` és `put` történik. Concurrent kérések azonos számlálót olvashatnak, a KV pedig eventual consistency jellegű.
- **Forgatókönyv:** elosztott vagy párhuzamos kliens több checkout/contact/result/admin próbát végez a névleges limit felett.
- **Üzleti hatás:** abuse, bot forgalom, költség és brute-force felület; a tényleges AI-generálást továbbra is payment/order quota korlátozza.
- **Javítás:** Cloudflare Rate Limiting/WAF, Durable Object vagy atomi D1 számláló; anonimizált kulcsképzés; e-mail+IP+globális limitek.
- **Teszt:** legalább 100 párhuzamos kérés több PoP-szimulációval sem haladja meg a limit+engedett toleranciát.

#### M-04 — AI spend, provider policy és adatkezelési beállítások távolról nem igazoltak

- **Severity / blocker:** Medium; P1 konfigurációs feltétel.
- **Érintett hely:** `worker/src/lib/ai.ts:223-285`; Google Cloud/AI Studio projekt.
- **Technikai magyarázat:** kódszinten fizetett rendeléshez kötött quota, max token, timeout és korlátos retry van, de nincs repositoryból igazolható projekt budget, quota alert, key restriction, logging/dataset-sharing beállítás vagy DPA. Az EEA-beli API-kliensekre a Google feltételei Paid Services használatot írnak elő; paid esetben a promptokat nem használják termékfejlesztésre a feltételek szerint: [Gemini API terms](https://ai.google.dev/gemini-api/terms). Bekapcsolt logging esetén külön retention érvényesülhet: [Gemini logs policy](https://ai.google.dev/gemini-api/docs/logs-policy).
- **Forgatókönyv:** kulcslopás vagy hibás automation költségcsúcsot okoz; bekapcsolt prompt logging indokolatlanul PII-t őriz.
- **Üzleti hatás:** költség, GDPR/adatfeldolgozói és megőrzési kockázat.
- **Javítás:** külön paid production project; restricted Auth key; napi/havi budget és quota alert/hard cap ahol elérhető; logging kikapcsolása vagy minimális retention; DPA és adatkezelési dokumentáció.
- **Teszt:** billing alert teszt; quota túllépés kontrollált 429-et ad; audit logban tiltott kulcshasználat látszik; prompt nincs provider datasetben/logban a választott policy szerint.

#### M-05 — Prompt delimiter lezárható, és PII kerülhet a Geminihez

**Remediációs státusz:** a delimiter-injection kódban javítva és tesztelve XML-karakter escapinggel. Az adatminimalizálás, provider DPA/logging policy és magas kockázatú emberi review külső P1 feladat marad.

- **Severity / blocker:** Medium; P1.
- **Érintett hely:** `worker/src/lib/ai.ts:133-140,161-220`.
- **Technikai magyarázat:** a felhasználói mezők XML-szerű tagbe vannak csomagolva, de a tagzáró karakterek nincsenek escape-elve. A system prompt és a secondary AI review csökkenti, de nem szünteti meg a prompt injectiont. A címzett, probléma, korábbi levelezés és kívánt eredmény személyes/szenzitív adatot tartalmazhat.
- **Forgatókönyv:** a felhasználó lezárja a taget és utasításnak látszó tartalmat injektál; a modell nem kívánt vagy bizalmas adatot reprodukál.
- **Üzleti hatás:** hibás levél, reputációs kár, indokolatlan harmadik fél adattovábbítás.
- **Javítás:** strukturált parts vagy megbízható escaping/JSON; explicit adatminimalizálás és érzékeny adatra figyelmeztetés; determinisztikus output schema; emberi review magas kockázatú levélnél.
- **Teszt:** taglezárás, indirect injection korábbi levelezésben, exfiltration- és HTML-payload corpus; output csak plain text és policy-kompatibilis.

#### M-06 — Stripe és Turnstile outbound hívásokon nincs explicit timeout

**Remediációs státusz:** javítva; Stripe 15 s, Turnstile 8 s timeoutot kapott, Stripe API-verzió pinelt, a Turnstile hostname és action fail-closed validált; negatív tesztek készültek.

- **Severity / blocker:** Medium; P1.
- **Érintett hely:** `worker/src/lib/stripe.ts:74-100`; `worker/src/lib/turnstile.ts:3-31`.
- **Technikai magyarázat:** Gemini, Számlázz.hu és az audit során Resend már explicit timeoutot használ, Stripe és Turnstile nem. Platform timeoutig elhúzódó fetch request és webhook-feldolgozás lehetséges.
- **Forgatókönyv:** provider hálózati hiba alatt a checkout vagy webhook végrehajtás elakad; Stripe ismétlések torlódnak.
- **Üzleti hatás:** availability, megnövekedett retry és feldolgozási késés.
- **Javítás:** endpointonként indokolt AbortSignal timeout; idempotens, jitteres és csak retryable státuszokra alkalmazott retry; Stripe API verzió rögzítése és tesztelése.
- **Teszt:** mesterséges 15–30 s provider késleltetés kontrollált 503/500-at és biztonságos webhook retry-t eredményez, duplikált teljesítés nélkül.

#### M-07 — A retention és érintetti törlés/export nem teljes

- **Severity / blocker:** Medium; P1.
- **Érintett hely:** `worker/src/lib/db.ts:1128-1186`; `frontend/src/pages/PrivacyPage.tsx`; D1 `orders`, `invoices`, `contact_messages`.
- **Technikai magyarázat:** 90 nap után a levéltartalom redaktálódik és a contact üzenet 2 év után törlődik, de név, e-mail, számlázási cím és adószám fizetett/számlázott orderben határozatlanul megmaradhat. Nincs adminisztratív export/törlés workflow. Számla megőrzése jogilag szükséges lehet, de az operatív duplikátumok megőrzése külön indoklást igényel.
- **Forgatókönyv:** törlési kérés manuálisan, hiányosan vagy a kötelező számla és a törölhető operatív adat megkülönböztetése nélkül történik.
- **Üzleti hatás:** GDPR/adatminimalizálási kockázat és nagyobb breach impact.
- **Javítás:** adatleltár és jogalap/retention mátrix jogásszal-könyvelővel; export/redact/delete admin workflow; processor deletion; backup retention összehangolása.
- **Teszt:** tesztuser DSAR export; törlés után minden nem kötelező rekord/mező eltűnik, kötelező számla elkülönítve és auditálva marad.

#### M-08 — A jogi elfogadás ténye és verziója nincs bizonyíthatóan tárolva

**Remediációs státusz:** kódban és additív `0011_legal_acceptance_evidence.sql` migrációval javítva. A tényleges `LEGAL_TERMS_VERSION` és `PRIVACY_POLICY_VERSION` értéket jogász által jóváhagyott publikált dokumentumhoz kell kötni a deploy előtt.

- **Severity / blocker:** Medium; P1.
- **Érintett hely:** `worker/src/lib/validation.ts:68-83`; order insert/migrations.
- **Technikai magyarázat:** `legalAccepted: true` szükséges a requestben, de nem kerül tárolásra terms/privacy verzióval, időponttal és bizonyítékkal.
- **Forgatókönyv:** chargeback vagy fogyasztóvédelmi vita esetén nem bizonyítható, melyik feltételt fogadta el a vevő.
- **Üzleti hatás:** jogvita, refund/chargeback veszteség. Ez nem jogi tanács; magyar jogász ellenőrzése szükséges.
- **Javítás:** versioned legal document hash/id, accepted_at, szükség esetén minimalizált IP/UA retention; checkout session metadata és order audit. Ez adatbázis-migráció, ezért automatikusan nem módosítottam.
- **Teszt:** elfogadás nélkül 400; sikeres orderben immutable verzió/időpont; dokumentumváltás után új verzió tárolódik.

#### M-09 — Nincs igazolt monitoring, alerting és incidens-korreláció

- **Severity / blocker:** Medium; P1.
- **Érintett hely:** `worker/src/lib/logger.ts:91-102`; Cloudflare/Stripe/Google/Resend/Számlázz.hu külső konfiguráció.
- **Technikai magyarázat:** strukturált és redaktált console log van, de nincs konfigurált error monitoring, Logpush/SIEM retention, request/correlation ID, AI spend alert, webhook backlog/failure alert, admin/fraud alert vagy on-call runbook.
- **Forgatókönyv:** a mostani `503/522`, webhook-hiba vagy AI-költségcsúcs csak felhasználói panasz után derül ki.
- **Üzleti hatás:** magas MTTD/MTTR, bevétel- és bizonyítékvesztés.
- **Javítás:** Cloudflare health/Workers/D1 alert, Stripe webhook monitoring, Google billing alert, centralizált redaktált logok, correlation ID, audit eventek és incident runbook.
- **Teszt:** szintetikus health hiba, webhook 500 és AI budget threshold 5 percen belüli értesítést okoz; incident timeline rekonstruálható.

#### M-10 — Nincs igazolt end-to-end staging frontend

- **Severity / blocker:** Medium; P1.
- **Érintett hely:** `.github/workflows/deploy-worker.yml`; `.github/workflows/deploy-frontend.yml:15-93`.
- **Technikai magyarázat:** backend sandbox deploy létezik, a frontend workflow viszont production/github-pages környezetre épül. Külön staging domain, frontend env, Turnstile hostname, Stripe endpoint és webhook nincs E2E bizonyítva.
- **Forgatókönyv:** payment/redirect/CORS/domain változás először productionben találkozik a teljes rendszerrel.
- **Üzleti hatás:** release regresszió és visszaállási kockázat.
- **Javítás:** külön staging frontend + Worker + D1 + KV + Stripe test webhook + Számlázz.hu teszt account + Resend teszt/engedélyezett címek.
- **Teszt:** a manuális tesztterv teljes payment és AI folyamata stagingen sikeres production deploy előtt.

#### M-11 — A production Worker közvetlen `workers.dev` originje bekapcsolva marad

- **Severity / blocker:** Medium; P1.
- **Érintett hely:** `.github/workflows/deploy-worker.yml:201-205`.
- **Technikai magyarázat:** a közvetlen origin megkerülheti a custom domainhez kötött WAF/Access/routing kontrollokat. A live frontend jelenleg éppen ezt használja.
- **Forgatókönyv:** admin/API támadó a custom domain edge szabályai helyett a workers.dev címet célozza.
- **Üzleti hatás:** kontrollmegkerülés, eltérő monitoring és origin drift.
- **Javítás:** custom domain helyreállítása után productionben `workers_dev = false`; sandbox külön maradhat elérhető.
- **Teszt:** workers.dev 404/tiltott, custom domain health és API működik; webhook URL custom domain.

#### M-12 — A secret bulk sync nem törölte a már feleslegessé vált távoli secreteket — javítva

- **Severity / blocker:** Medium; P1.
- **Érintett hely:** `.github/workflows/deploy-worker.yml:282-318`.
- **Technikai magyarázat:** a korábbi workflow csak a nem üres értékeket töltötte fel, ezért egy GitHub Environmentből törölt secret a Workerben tovább élhetett. Rollbackelt Worker esetén a külön `wrangler secret bulk` ezen felül Cloudflare 10215 hibával blokkolhatta a következő deployt.
- **Forgatókönyv:** régi kulcs vagy demo credential rotáció után is aktív marad a távoli runtime-ban.
- **Üzleti hatás:** credential drift, szükségtelen támadási felület.
- **Javítás:** a secret bundle a kóddal együtt, atomikusan kerül fel a `wrangler deploy --secrets-file` kapcsolóval; a workflow explicit `null` bulk művelettel törli az `OPENAI_API_KEY` és `DEMO_ACCESS_CODE` stale neveket. A deploy előtt rögzíti az aktív verziót, és health hiba esetén kifejezetten arra rollbackel.
- **Teszt:** workflow regressziós teszt ellenőrzi az atomikus secret deployt, a stale allowlistet és az explicit rollback targetet; sandbox deploy után Worker secret inventoryban egyik stale név sem maradhat.

#### M-13 — Magyar adószám csak formátum szerint ellenőrzött, a számlázási hiba fizetés után jelentkezhet

- **Severity / blocker:** Medium; P1 üzleti/jogi feladat.
- **Érintett hely:** `worker/src/lib/billing.ts:62-63,109-115`; `worker/src/lib/validation.ts:38-50`.
- **Technikai magyarázat:** csak `8-1-2` számjegyformátum ellenőrzött, checksum/NAV vagy számlázói elővalidáció nem. A számla a fizetés webhookja után készül.
- **Forgatókönyv:** formailag helyes, de nem valós adószámmal a fizetés sikerül, a számla hibára/retry-ra kerül.
- **Üzleti hatás:** manuális ügyintézés, hibás számlázás, refund és compliance kockázat.
- **Javítás:** könyvelővel egyeztetett checksum és opcionális szolgáltatói elővalidáció; világos javítási workflow; az AAM számlázási beállítás és elállási/számlázási szöveg jogi-könyvelői review-ja. A hibás hard-coded 27%-os bontás 2026-08-10-én kódszinten javítva.
- **Teszt:** ismert valid/invalid adószám corpus; számlázói invalid response után nincs duplikált számla, admin javítás auditált.

#### M-14 — Rekurzív checkout kulcsvizsgálat mélységkorlát nélkül fut a Zod validáció előtt

- **Severity / blocker:** Medium; P2.
- **Érintett hely:** `worker/src/routes/createCheckoutSession.ts:45-64`; `worker/src/lib/billing.ts:66-102`.
- **Technikai magyarázat:** a maximum 64 KiB JSON tetszőlegesen mély objektuma rekurzívan bejárható; mélység- vagy nodeszám-limit nincs.
- **Forgatókönyv:** mesterségesen mély JSON stack overflowt vagy CPU-terhelést okoz még auth/rate-limit előtt.
- **Üzleti hatás:** célzott availability degradáció.
- **Javítás:** iteratív traversal explicit depth/node limit mellett, vagy előbb top-level strict schema és csak ismert mezők ellenőrzése.
- **Teszt:** 1 000+ szintű JSON kontrollált 400-at ad stack overflow nélkül; normál manipulált ár továbbra is blokkolt.

#### M-15 — Turnstile válaszból hostname/action nincs szerveroldalon ellenőrizve

- **Severity / blocker:** Medium; P2, de a widget hostname korlátozása kiadás előtt kötelező.
- **Érintett hely:** `worker/src/lib/turnstile.ts:3-31`; Cloudflare Turnstile widget konfiguráció.
- **Technikai magyarázat:** csak a `success` mező kerül kiértékelésre. A Cloudflare a hostnév-korlátozást és külön dev/prod widgetet támogatja: [Turnstile setup](https://developers.cloudflare.com/turnstile/get-started/).
- **Forgatókönyv:** tévesen túl tág widget-konfiguráció mellett más originről szerzett token kerül felhasználásra.
- **Üzleti hatás:** botvédelmi kontroll gyengülése, abuse-költség.
- **Javítás:** widget allowed hostnames exact staging/prod; opcionálisan expected hostname/action ellenőrzés; külön kulcspár környezetenként.
- **Teszt:** idegen hostname tokenje elutasított; staging token productionben elutasított; replay elutasított.

### Low

#### L-01 — GitHub Actions actionök floating major tagre vannak rögzítve

- **Severity / blocker:** Low; nem.
- **Hely:** `.github/workflows/*.yml`, például `actions/checkout@v4`, `setup-node@v4`.
- **Magyarázat/forgatókönyv/hatás:** upstream tag kompromittálása vagy váratlan változása CI supply-chain kódot futtathat; secretszivárgás lehetséges.
- **Javítás/teszt:** actionök teljes commit SHA-ra pinelése, Dependabot updates; workflow fork PR-en secret nélkül és mainen sikeres.

#### L-02 — A `lint` script valójában csak typecheck; nincs SAST/history-grade secret scan

- **Severity / blocker:** Low; nem, P2.
- **Hely:** root `package.json`; `.github/workflows/quality.yml`.
- **Magyarázat/forgatókönyv/hatás:** ESLint, Semgrep/CodeQL, gitleaks teljes history és IaC scan hiányában regresszió vagy új secret később átjuthat.
- **Javítás/teszt:** ESLint security szabályok, CodeQL/Semgrep, gitleaks `git` mode; szándékos teszt fixture megfelelő allowlisttel.

#### L-03 — Több dependency lemaradt, és nincs automatikus dependency PR folyamat

- **Severity / blocker:** Low; nem.
- **Hely:** `package.json`, `frontend/package.json`, `worker/package.json`, `package-lock.json`.
- **Magyarázat/forgatókönyv/hatás:** audit szerint nincs ismert vulnerability, de Hono/React Router/Vitest patch és több major elérhető; kontrollálatlan későbbi ugrás vagy elmaradó security patch kockázat.
- **Javítás/teszt:** patch/minor frissítés külön PR-ekben, major csak kompatibilitási teszttel; Dependabot/Renovate; teljes suite/build.

#### L-04 — A Stripe API-verzió nincs requestben rögzítve

- **Severity / blocker:** Low; nem.
- **Hely:** `worker/src/lib/stripe.ts:74-100`.
- **Magyarázat/forgatókönyv/hatás:** account default API-verzió változása response shape driftet okozhat.
- **Javítás/teszt:** kiválasztott Stripe API version header és szerződéses fixture tesztek; sandbox Workbench replay.

#### L-05 — Nincs dokumentált dependency/image/SAST toolchain ownership

- **Severity / blocker:** Low; nem.
- **Hely:** CI és üzemeltetési dokumentáció.
- **Magyarázat/forgatókönyv/hatás:** scanner találat felelőse/SLA nélkül a findingok elévülnek. Docker image scan jelenleg N/A, mert nincs image.
- **Javítás/teszt:** Critical 24h, High 7 nap triage SLA; scanner owner; havi security review; próba finding végigvezetése.

### Informational és pozitív kontrollok

- **I-01:** nincs Docker, file upload, shell execution, template engine vagy dinamikus SQL; az ezekhez kötődő container-root/path traversal/command injection osztályok jelenleg N/A vagy nem találtak.
- **I-02:** nincs klasszikus user account, jelszó, JWT vagy cookie session. A dormant subscription/magic-link adatmodell aktiválása előtt külön auth threat model szükséges.
- **I-03:** a Stripe HUF összeg konverziója megfelel a charge minor-unit szabálynak (`worker/src/lib/stripe.ts:44-65`), lásd [Stripe currencies](https://docs.stripe.com/currencies?locale=en-GB). Webhook signature, event idempotency, exact amount/currency, refund/dispute és server-side entitlement kontroll tesztekkel lefedett.

### Audit közben lezárt, alacsony kockázatú tételek

1. **Rate-limit PII logging:** az IP/e-mail identifier kikerült a `rate_limited` és `rate_limit_kv_missing` eseményekből; regressziós teszt készült (`worker/src/lib/rateLimit.ts`, `worker/test/rateLimit.test.ts`).
2. **Resend timeout és hiba-adatminimalizálás:** 10 s timeout, explicit User-Agent, provider body nélküli error; tesztek készültek (`worker/src/lib/email.ts`, `worker/test/email.test.ts`). A Resend API bearer kulcsot és User-Agentet vár: [Resend API introduction](https://resend.com/docs/api-reference/introduction).
3. **Secret hygiene:** a `.env.example` már csak dokumentált placeholdert tartalmaz; a meglévő, gitignore-olt lokális env fájlok jogosultsága `0600` lett. Valódi érték nem módosult és nem került kiírásra.

## 4. Production blockerek

| ID | Blokkoló feltétel | Feloldás bizonyítéka |
|---|---|---|
| H-01 | Custom API 522; workers.dev health 503; frontend degradált originre mutat | Custom API `/api/health` 200, frontend ugyanarra a custom originre buildelve, sandbox E2E smoke zöld |
| H-02 | Lezárva projektgazdai megerősítés alapján | A revoke, usage audit és új production key 2026-07-18-án késznek jelezve; bizonyítékot ne tegyünk repositoryba |
| H-03 | A gate-ek kódban elkészültek, de még nincs sikeres remote run/restore drill | Workflow run Time Travel bookmarkkal, post-deploy smoke-kal és próbált rollbackkel |
| H-04 | **Kódban feloldva:** production admin API letiltott; deploy bizonyíték még kell | `ADMIN_API_ENABLED=false`, endpoint 404 és authorization tesztek zöldek; későbbi engedélyezéshez Access+MFA |
| Külső konfiguráció | Live Stripe/Számlázz/Resend/Turnstile/Gemini/Cloudflare beállítások távolról nem ellenőrizhetők a repóból | Kétszemélyes konfiguráció-review és staging bizonyíték a 6. és 9. fejezet szerint |

## 5. Szükséges secretek és environment variable-ök táblázata

Jelölés: **S** = kizárólag szerver/deploy oldali; **P** = publikus, frontend bundle-ben megjelenhet; **K** = környezetfüggően kötelező. A táblázat nem tartalmaz értéket.

| Változó neve | Kötelező/opcionális | Komponens | Mire szolgál | Development érték típusa | Production érték típusa | Hol kell létrehozni | Ajánlott tárolás | Frontendbe? | Rotálni? | Validáció induláskor/buildkor |
|---|---|---|---|---|---|---|---|---|---|---|
| `VITE_API_BASE_URL` | kötelező | frontend | API origin | localhost/sandbox URL | custom HTTPS API origin | Cloudflare Worker custom domain után | GitHub Environment variable | **P: igen** | nem | build workflow HTTPS-t ellenőriz |
| `VITE_BASE_PATH` | kötelező | frontend | router/assets base | `/` | deploy path, jellemzően `/` | hosting konfiguráció | GitHub Environment variable | **P: igen** | nem | buildkor `/` prefix ellenőrzött |
| `VITE_SITE_URL` | kötelező | frontend | canonical site URL | localhost URL | production HTTPS URL | DNS/hosting után | GitHub Environment variable | **P: igen** | nem | buildkor HTTPS ellenőrzött |
| `VITE_TURNSTILE_SITE_KEY` | kötelező non-demo | frontend | publikus widget site key | dev widget site key | prod widget site key | Cloudflare Turnstile widget | GitHub Environment variable | **P: igen** | secret pár cseréjekor | buildkor nem üres |
| `VITE_DEMO_MODE` | kötelező | frontend | UI mód flag | `true`/`false` | mindig `false` | projektkonfiguráció | GitHub Environment variable | **P: igen** | nem | production build `false`-t követel |
| `DB` | kötelező | Worker | D1 binding | local/sandbox D1 | production D1 | Cloudflare D1 | Worker binding | **S: nem** | N/A | runtime env guard + health query |
| `RATE_LIMIT_KV` | K: non-demo | Worker | rate-limit storage | sandbox KV | külön prod KV | Cloudflare KV | Worker binding | **S: nem** | N/A | non-demo runtime guard |
| `GEMINI_API_KEY` | kötelező | Worker | Gemini API auth | külön restricted dev key | külön restricted paid prod Auth key | Google AI Studio / Cloud Console | Cloudflare Worker secret; GitHub Environment secret csak deployhoz | **S: soha** | **igen, most**; utána policy szerint | runtime nem üres; formátum/restriction távolról ellenőrzendő |
| `GEMINI_MODEL` | opcionális, ajánlott explicit | Worker | standard modell | pinelt dev model ID | pinelt támogatott prod model ID | Google model catalog | Worker var | **S: nem szükséges** | nem | kód fallback; metadata preflight checkout előtt |
| `GEMINI_MODEL_PREMIUM` | opcionális, ajánlott explicit | Worker | prémium modell | pinelt dev ID | pinelt prod ID | Google model catalog | Worker var | **S: nem szükséges** | nem | kód fallback + metadata preflight |
| `GEMINI_REVIEW_MODEL` | opcionális, ajánlott explicit | Worker | AI output review | pinelt dev ID | pinelt prod ID | Google model catalog | Worker var | **S: nem szükséges** | nem | kód fallback + metadata preflight |
| `TOKEN_HASH_SECRET` | kötelező | Worker | capability HMAC/hash | legalább 32 karakteres random | legalább 32 karakteres CSPRNG secret | lokálisan biztonságos secret generator/KMS | Cloudflare Worker secret; GitHub Environment secret | **S: soha** | expozíciónál; tervezetten, mert csere invalidálja a tokeneket | min. 32 karakter runtime guard |
| `STRIPE_SECRET_KEY` | K: payment | Worker | Stripe server API | test secret key | live restricted/secret key | Stripe Dashboard/Workbench | Cloudflare Worker secret; GitHub Environment secret | **S: soha** | expozíciónál és periodikusan | test/live prefix és payment mode ellenőrzött |
| `STRIPE_WEBHOOK_SECRET` | K: payment | Worker | webhook HMAC secret | test endpoint secret | prod endpoint secret | Stripe Workbench webhook endpoint | Cloudflare Worker secret; GitHub Environment secret | **S: soha** | endpointcsere/expozíció | `whsec_` formátum és signature runtime ellenőrzött |
| `TURNSTILE_SECRET_KEY` | K: non-demo | Worker | Siteverify auth | dev widget secret | prod widget secret | Cloudflare Turnstile widget | Cloudflare Worker secret; GitHub Environment secret | **S: soha** | külön env; kompromittálódáskor | non-demo runtime guard |
| `TURNSTILE_EXPECTED_HOSTNAMES` | K: non-demo | Worker | Siteverify válasz exact hostname-korlátja | `localhost`/staging host | kizárólag production frontend host | Cloudflare Turnstile widget hostlistájával együtt | Worker/GitHub Environment variable | nem secret | hostváltozáskor | non-demo guard; scheme/port/path/wildcard tiltott |
| `SZAMLAZZ_AGENT_KEY` | K: payment | Worker | Számla Agent auth | dedikált tesztfiók kulcs | live fiók kulcs | Számlázz.hu Vezérlőpult → Számla Agent kulcsok | Cloudflare Worker secret; GitHub Environment secret | **S: soha** | expozíciónál; külön test/live | payment módban kötelező, lowercase ellenőrzött |
| `ADMIN_API_ENABLED` | kötelezően explicit | Worker/admin | admin API fail-closed kapcsoló | `false`, sandboxban indokoltan `true` | kötelezően `false` | projektkonfiguráció | Worker/GitHub Environment variable | nem secret | nem | csak `true`/`false`; live+true tiltott |
| `ADMIN_API_TOKEN` | csak ha admin API engedélyezett sandboxban | Worker/admin | ideiglenes admin bearer | külön random sandbox token | **ne hozd létre productionben** | CSPRNG | sandbox Worker/GitHub Environment secret | **S: soha** | sandbox ciklusonként/expozíciónál | csak engedélyezett adminnál min. 32 karakter |
| `RESEND_API_KEY` | K: payment/production | Worker | tranzakciós e-mail API | restricted test key | send-only prod key | Resend Dashboard → API Keys | Cloudflare Worker secret; GitHub Environment secret | **S: soha** | expozíciónál/periodikusan | payment módban és production workflow-ban kötelező |
| `EMAIL_FROM` | K: e-mailhez | Worker | verified sender | sandbox sender | verified domain sender | Resend domain verification | Worker var / GitHub Environment variable | publikus senderként igen, de nem frontend config | nem | send előtt nem üres, production preflight szükséges |
| `SITE_URL` | kötelező | Worker | redirect/e-mail base URL | localhost/staging | production HTTPS site | DNS/hosting | Worker var | nem secret | nem | live payment módban HTTPS runtime guard |
| `ALLOWED_ORIGINS` | kötelező | Worker | exact CORS allowlist | localhost/staging originek | kizárólag prod frontend origin | architektúra/DNS | Worker var | nem secret | nem | live módban minden origin HTTPS |
| `DEMO_MODE` | kötelezően explicit | Worker | demo flow kapcsoló | szükség szerint `true` | `false` | projektkonfiguráció | Worker var | nem | nem | paymenttel együtt true tiltott |
| `DEMO_ACCESS_CODE` | csak demo | Worker | demo bypass capability | külön random dev code | **nem hozandó létre prodon** | CSPRNG | sandbox Worker secret | **S: soha** | demo ciklusonként | demo-only módban min. 16 karakter |
| `PAYMENTS_ENABLED` | kötelezően explicit | Worker | payment route kapcsoló | `false`/sandbox | `true` | projektkonfiguráció | Worker var | nem secret | nem | env guarddal összefüggő módok ellenőrzöttek |
| `PAYMENT_MODE` | K: payment | Worker | Stripe test/live szeparáció | `test` | `live` | projektkonfiguráció | Worker var | nem secret | nem | enum + Stripe key prefix |
| `SZAMLAZZ_TEST_ACCOUNT_CONFIRMED` | K: test payment | Worker | véletlen live invoice elleni guard | `true` igazolt tesztfióknál | `false` | manuális ellenőrzés | Worker var | nem secret | nem | test/live kombináció runtime ellenőrzött |
| `SELLER_NAME` | K: production számla/e-mail | Worker | jogi eladó neve | placeholder tesztadat | valódi jogi név | cég/könyvelés | Worker var | üzleti publikus adat | változáskor | production workflow ellenőrizze nem üresre |
| `SELLER_ADDRESS` | K: production számla/e-mail | Worker | eladó címe | placeholder tesztadat | jogi cím | cég/könyvelés | Worker var | üzleti publikus adat | változáskor | production workflow ellenőrizze nem üresre |
| `SELLER_TAX_NUMBER` | K: production számla | Worker | eladó adószáma | tesztérték | valós adószám | cég/könyvelés | Worker var | üzleti publikus adat | változáskor | production workflow/formátum validáció szükséges |
| `LEGAL_TERMS_VERSION` | kötelező | Worker | elfogadott ÁSZF verzió bizonyítéka | tesztdátum/verzió | publikált, jogász által jóváhagyott verzió-ID | jogi dokumentum release | Worker/GitHub Environment variable | nem secret | dokumentumváltáskor | nem üres runtime/deploy guard; orderbe mentődik |
| `PRIVACY_POLICY_VERSION` | kötelező | Worker | elfogadott privacy verzió bizonyítéka | tesztdátum/verzió | publikált, jóváhagyott verzió-ID | privacy dokumentum release | Worker/GitHub Environment variable | nem secret | dokumentumváltáskor | nem üres runtime/deploy guard; orderbe mentődik |
| `CLOUDFLARE_API_TOKEN` | kötelező deployhoz | GitHub Actions | Worker/D1/KV deploy | sandbox-scope token | külön least-privilege prod token | Cloudflare → API Tokens | GitHub Environment secret, nem Worker runtime | **S: soha** | kiadás előtt scope review; periodikusan | workflow API/D1 visibility check |
| `CLOUDFLARE_ACCOUNT_ID` | kötelező deployhoz | GitHub Actions | account target | sandbox account ID | prod account ID | Cloudflare dashboard | GitHub Environment variable | nem secret | nem tipikusan | D1 visibility check |
| `CLOUDFLARE_D1_DATABASE_ID` | kötelező deployhoz | GitHub Actions | D1 binding target | sandbox UUID | prod UUID | Cloudflare D1 | GitHub Environment variable | **S: nem** | nem | workflow összeveti a látható DB-vel |
| `CLOUDFLARE_KV_NAMESPACE_ID` | K: non-demo deploy | GitHub Actions | KV binding target | sandbox ID | prod ID | Cloudflare KV | GitHub Environment variable | **S: nem** | nem | jelenleg config-generálás; távoli existence check hozzáadandó |
| `D1_DATABASE_NAME` | kötelező deployhoz | GitHub Actions | migration target | sandbox név | prod név | Cloudflare D1 | GitHub Environment variable | **S: nem** | nem | migration parancs használja |
| `WORKER_NAME` | kötelező deployhoz | GitHub Actions | deploy target | sandbox worker név | prod worker név | Cloudflare Workers | GitHub Environment variable | publikus hostname része lehet | nem | config-generálás |
| `API_HEALTH_URL` | kötelező deployhoz | GitHub Actions | post-deploy gate célja | sandbox custom HTTPS `/api/health` | production custom HTTPS `/api/health` | Worker custom domain/DNS után | GitHub Environment variable | nem secret | nem | exact HTTPS `/api/health`; productionben nem `workers.dev` |

**Nem szükséges a jelenlegi implementációhoz:** `DATABASE_URL`, DB username/password, JWT/session/auth secret, OAuth client ID/secret, Stripe publishable key, object storage credential, külön at-rest encryption key, Redis/queue URL, analytics key, error monitoring DSN, Gemini organization/project ID. Ha új szolgáltatás kerül be, ezt a listát és az env validationt frissíteni kell.

A biztonságos placeholder fájl elkészült: `.env.example`. A lokális `.env`/`.dev.vars` fájlok nem vihetők frontend bundle-be vagy Gitbe.

## 6. Létrehozandó külső erőforrások és szolgáltatói beállítások

1. **Cloudflare:** külön staging és production Worker, D1 és KV; custom domain; productionben `workers.dev` tiltás; Turnstile widget külön hostname-listával; Cloudflare Access admin policy; least-privilege deploy token; health/Worker/D1 alert; Time Travel restore próba. Környezetenként külön D1 binding javasolt a [Cloudflare environments útmutató](https://developers.cloudflare.com/d1/configuration/environments/) szerint.
2. **Stripe:** külön test/live kulcs; live webhook endpoint a custom API domainen; legalább `checkout.session.completed`, payment failed/async failed, expired, refund/charge és dispute események; webhook retry/monitoring; restricted key ahol a szükséges API-jogosultság engedi. Kulcs- és webhook-kezelés: [Stripe API keys](https://docs.stripe.com/keys).
3. **Google AI:** paid production project (EEA); restricted Auth key; generative language API restriction; billing account, budget/quota alerts; prompt logging/dataset sharing policy; DPA és processor nyilvántartás. Kulcslétrehozás és billing: [Gemini quickstart](https://ai.google.dev/gemini-api/docs/get-started).
4. **Resend:** domain DNS verification (SPF/DKIM/DMARC), send-only production API key, verified `EMAIL_FROM`, bounce/complaint monitoring. Kulcs/domain kezelés: [Resend CLI és dashboard](https://resend.com/docs/cli).
5. **Számlázz.hu:** külön teszt account Agent kulcs és live account Agent kulcs; eladóadatok és az igazolt AAM adózási státusz könyvelői jóváhagyása; sztornó/helyesbítő/refund folyamat. A Számla Agent kulcs a Vezérlőpult „Számla Agent Kulcsok” részén hozható létre: [Számlázz.hu ÁSZF](https://www.szamlazz.hu/wp-content/uploads/2025/09/Sza%CC%81mla%CC%81zz.hu-A%CC%81SZF-2025.10.01.pdf).
6. **GitHub:** `sandbox`, `production`, `github-pages` Environment protection, required reviewers, környezetenkénti variables/secrets, branch protection és CODEOWNERS a workflow/payment fájlokra.
7. **DNS/hosting:** frontend és API domain; HTTPS enforcement; headerképes edge; Stripe/Turnstile/Resend DNS rekordok; monitorozott tanúsítvány-megújítás.
8. **Monitoring:** Cloudflare Logpush vagy választott SIEM/error monitor. Ha új DSN/API key kerül be, csak akkor kerüljön az env táblába; jelenleg ilyen integráció nincs a kódban.

## 7. P0–P2 javítási terv

### P0 – Production blocker

#### P0-1 — Production API és domain helyreállítása

- **Módosítás:** Cloudflare Worker production binding/secrets/custom domain ellenőrzése; health okának azonosítása; frontend API origin átállítása; hibás production deploy tiltása.
- **Érintett fájlok:** `.github/workflows/deploy-worker.yml`, `.github/workflows/deploy-frontend.yml`, esetleg `worker/wrangler.toml` generálás; külső Cloudflare/GitHub Environment konfiguráció.
- **Függőség:** production D1/KV/Worker hozzáférés; a P0-2 új AI kulcsa; custom DNS.
- **Teszt:** `/api/health` 200; CORS preflight; sandbox checkout/result/contact; frontend bundle-ben csak a custom API origin.
- **Acceptance criteria:** 30 perces szintetikus health stabil; workers.dev nem használt/productionben tiltott; 522/503 nincs; hibás env deploy workflow-ban bukik.

#### P0-2 — Történeti AI-kulcs incidenskezelése és új restricted production key

- **Módosítás:** régi kulcs revoke, usage audit, új paid-project Auth key restriction, budget/quota alert; a history tisztításáról külön koordinált döntés.
- **Érintett fájlok:** Git history; GitHub `production`/`sandbox` secret; Cloudflare Worker secret; incident record. Forráskód módosítás nem feltétlen szükséges.
- **Függőség:** Google AI Studio/Cloud Console owner/billing jogosultság.
- **Teszt:** régi kulcs nem használható; új kulccsal metadata és staging generálás működik; más Google API nem hívható.
- **Acceptance criteria:** revoke képernyőkép/audit bizonyíték; jogosulatlan usage triage; `GEMINI_API_KEY` külön staging/prod; budget alert próbálva.

#### P0-3 — Biztonságos deployment gate, restore point és rollback

- **Módosítás:** pre-deploy D1 Time Travel bookmark/azonosító; migration dry-run; előző Worker version rögzítése; deploy után health, CORS, checkout metadata preflight és webhook-safe smoke; automatikus stop/rollback runbook.
- **Érintett fájlok:** `.github/workflows/deploy-worker.yml`, `docs/deployment.md`, `docs/testing.md` vagy új runbook.
- **Függőség:** P0-1 health endpoint; Cloudflare API token megfelelő, de minimális scope-ja.
- **Teszt:** hibás secret, hibás binding és hibás migration szimuláció stagingen; Worker rollback és D1 restore drill.
- **Acceptance criteria:** sikertelen health esetén workflow piros; előző Worker 10 percen belül visszaállítható; D1 restore RPO/RTO dokumentált és próbált.

#### P0-4 — Admin API védelme vagy ideiglenes kikapcsolása

- **Módosítás:** Cloudflare Access identity+MFA/service policy; custom-domain-only route; audit actor. Ha ez nem kész, production flaggel ne regisztrálódjanak az admin route-ok.
- **Érintett fájlok:** `worker/src/index.ts`, `worker/src/routes/adminInvoice.ts`, `worker/src/lib/types.ts`, `worker/src/lib/envValidation.ts`, route tesztek; Cloudflare Access.
- **Függőség:** Cloudflare Access account/policy; admin felhasználók listája.
- **Teszt:** anonymous/expired/wrong audience/old static token; valid identity; two-person retry workflow; audit log.
- **Acceptance criteria:** publikus internet felől identity nélkül 403; MFA kötelező; minden admin művelet actor/time/order/action/result mezőkkel auditált.

#### P0-5 — Production provider-konfiguráció kétszemélyes validációja

- **Módosítás:** Stripe live/test, webhook, Számlázz.hu account, Resend sender, Turnstile hostname, Gemini project és Cloudflare binding ellenőrzőlap.
- **Érintett fájlok:** `docs/production-config.md`, GitHub Environments; szolgáltatói dashboardok.
- **Függőség:** szolgáltatói account owner és könyvelő/jogász.
- **Teszt:** kizárólag staging/test módú E2E, majd alacsony összegű, előre jóváhagyott live smoke külön döntéssel (az audit nem indított ilyet).
- **Acceptance criteria:** minden secret neve/owner/created/last-rotated dátuma dokumentált érték nélkül; live és test kulcs nem keverhető; webhook dashboard zöld.

### P1 – Kiadás előtt erősen ajánlott

#### P1-1 — Query token kiváltása egyszer használatos exchange flow-val

- **Módosítás/fájlok:** új exchange code tábla és endpoint; `worker/src/lib/stripe.ts`, order result route-ok, `frontend/src/pages/SuccessPage.tsx`, `CancelPage.tsx`, `worker/src/lib/email.ts`, D1 migráció.
- **Függőség/kockázat:** adatbázis-migráció és Stripe redirect kompatibilitás; fokozatos dual-read migráció szükséges.
- **Teszt:** single-use, TTL, replay, old link migration, referrer/history.
- **Acceptance criteria:** tartós bearer token nem jelenik meg URL-ben, access logban vagy historyban; régi linkek kontrolláltan kezeltek.

#### P1-2 — Frontend headerképes hosting/edge hardening

- **Módosítás/fájlok:** hosting konfiguráció, `frontend/index.html` CSP egyszerűsítése, deploy workflow smoke.
- **Függőség:** DNS/Cloudflare Pages vagy proxy döntés.
- **Teszt:** CSP report-only, clickjacking, Turnstile, routing és Stripe redirect.
- **Acceptance criteria:** minden 2xx/404 HTML válasz HSTS+CSP+frame+referrer+permissions headerrel; nincs CSP violation normál flow-ban.

#### P1-3 — Atomi rate limiting és provider timeout/retry policy

- **Módosítás/fájlok:** `worker/src/lib/rateLimit.ts`, `stripe.ts`, `turnstile.ts`; WAF/DO/D1 config; tesztek.
- **Függőség:** választott Cloudflare rate-limit megoldás; payment retry threat model.
- **Teszt:** concurrency, multi-key, provider timeout, Stripe webhook retry/idempotency.
- **Acceptance criteria:** burst nem lépi túl a dokumentált toleranciát; minden outbound callnak véges timeoutja és retry-mátrixa van; duplikált pénzügyi mellékhatás nincs.

#### P1-4 — AI governance és prompt boundary hardening

- **Módosítás/fájlok:** `worker/src/lib/ai.ts`, AI teszt corpus, privacy dokumentum; Google project policy.
- **Függőség:** adatvédelmi döntés és modellválasztás. A támogatott modelleket deploy előtt a [Gemini model dokumentációban](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash) kell újra ellenőrizni.
- **Teszt:** injection corpus, output schema, PII minimization, quota/429/timeout, provider logging policy.
- **Acceptance criteria:** strukturált escaping; output plain text/schema valid; budget/quota alert aktív; EEA Paid Services és DPA dokumentált.

#### P1-5 — Retention, DSAR és legal acceptance bizonyíték

- **Módosítás/fájlok:** új D1 migráció, `worker/src/lib/db.ts`, checkout insert, privacy/terms oldalak, admin DSAR tooling.
- **Függőség:** magyar jogász és könyvelő döntése a számla/operatív adatok megőrzéséről.
- **Teszt:** export, delete/redact, immutable terms version, backup expiry.
- **Acceptance criteria:** adatmezőnként owner/jogalap/retention; tesztelt export/törlés SLA; kötelező számla elkülönítve; terms verzió bizonyítható.

#### P1-6 — Monitoring, audit és incident response

- **Módosítás/fájlok:** correlation ID middleware/logger, admin/payment/AI audit eventek, monitoring-as-config/runbook.
- **Függőség:** Logpush/SIEM/error monitor választása és on-call címzett.
- **Teszt:** synthetic outage, webhook 500, AI spend, admin auth failure, log PII/secret scan.
- **Acceptance criteria:** P0 alert 5 percen belül; 30 napos kereshető incident log; secret/levéltartalom/e-mail/IP nincs normál logban; havi drill.

#### P1-7 — Külön staging frontend és teljes sandbox payment stack

- **Módosítás/fájlok:** új frontend staging workflow/environment, staging URL/CORS/Turnstile/Stripe webhook; dokumentáció.
- **Függőség:** P0-1 és staging külső erőforrások.
- **Teszt:** a 9. fejezet teljes E2E terve.
- **Acceptance criteria:** production deploy csak zöld staging build+payment+AI+invoice smoke után engedélyezett.

#### P1-8 — `workers.dev` és secret drift megszüntetése

- **Módosítás/fájlok:** `.github/workflows/deploy-worker.yml`; productionben `workers_dev=false`; deklaratív secret inventory.
- **Függőség:** működő custom domain és Access.
- **Teszt:** workers.dev tiltás, távoli secret list diff, secret eltávolítás sandbox próbája.
- **Acceptance criteria:** egyetlen dokumentált production API origin; felesleges távoli secret nincs; hiányzó kötelező secret fail-closed.

#### P1-9 — Számlázási és adózási edge case-ek rendezése

- **Módosítás/fájlok:** `worker/src/lib/billing.ts`, validation, invoice/admin UI és tesztek; jogi oldalak.
- **Függőség:** könyvelő/Számlázz.hu ajánlás.
- **Teszt:** valid/invalid adószám, fizetés utáni invoice failure, refund/storno/helyesbítő számla.
- **Acceptance criteria:** nincs manuálisan beragadt, láthatatlan számlahiba; minden refundhoz dokumentált számlakorrekció; jogi szöveg jóváhagyva.

### P2 – Kiadás után rövid időn belül

#### P2-1 — Rekurzív input traversal korlátozása

- **Fájl:** `worker/src/lib/billing.ts`; iteratív depth/node limit.
- **Függőség:** nincs.
- **Teszt/acceptance:** mély 64 KiB payload 400-at ad, Worker exception nélkül; manipulált ár detektálás változatlan.

#### P2-2 — Turnstile response context validáció

- **Fájl:** `worker/src/lib/turnstile.ts`, frontend widget action.
- **Függőség:** exact staging/prod hostname és action naming.
- **Teszt/acceptance:** idegen hostname/action token blokkolt; normál flow zöld.

#### P2-3 — CI supply-chain és statikus security toolchain

- **Fájl:** `.github/workflows/quality.yml`, Dependabot config, package lint config.
- **Függőség:** scanner policy és false-positive owner.
- **Teszt/acceptance:** ESLint, CodeQL/Semgrep és gitleaks history kötelező check; actionök SHA-pinelve; Critical/High finding blokkol.

#### P2-4 — Kontrollált dependency frissítés

- **Fájl:** package manifestek és lockfile.
- **Függőség:** P2-3 automation.
- **Teszt/acceptance:** patch/minor frissítések teljes 322+ teszttel/builddel; major külön kompatibilitási PR-ben; friss online `npm audit` a CI-ben legyen zöld.

#### P2-5 — Operációs ownership és havi restore/security drill

- **Fájl:** runbookok, ownership/CODEOWNERS.
- **Függőség:** monitoring és backup.
- **Teszt/acceptance:** név szerinti owner és SLA; havi restore, secret rotation és incident tabletop dokumentált.

## 8. Automatikus ellenőrzések eredménye

| Ellenőrzés | Parancs/módszer | Eredmény |
|---|---|---|
| Type check | `npm run typecheck` | **PASS** frontend + Worker |
| Teljes teszt | `npm test` | **PASS: 29 fájl, 322 teszt** |
| Payment smoke | `npm run test:payment-smoke` | **PASS: 3 fájl, 66 teszt** |
| Production build | `npm run build` | **PASS**; frontend JS 303.89 kB / 94.55 kB gzip; Worker TypeScript pass |
| Dependency audit | `npm audit --offline --audit-level=high` | **PASS az elérhető cache alapján: 0 találat**; a friss online audit DNS/hitelesítési korlát miatt nem futott le, CI-ben megismétlendő |
| Dependency freshness | `npm outdated` | Elérhető több patch/minor és major; automatikus major update nem történt. Kiemelt patch/minor: Hono, React/React Router, Vitest, PostCSS. |
| Lockfile | `npm ci --ignore-scripts`, Wrangler verzió/CLI help | **PASS**; reprodukálható install, Wrangler pontosan 4.102.0 |
| D1 migráció dry-run | 0001–0012 üres SQLite-on, `foreign_key_check`, `integrity_check` | **PASS: integrity `ok`; refund lifecycle tábla és mezők létrejöttek** |
| Secret scan — aktuális tree | prefix/generic minták, tracked/untracked/ignore státusz, build artifact | Valódi server secretet a tracked tree/frontend bundle-ben nem talált; a gitignore-olt lokális secret fájlok léteznek, értéket nem írtam ki |
| Secret scan — Git history | teljes commit-history prefix scan | **FAIL/triage:** Google API-key formátumú történeti érték korábbi `aiReviewGate` revíziókban (H-02); Stripe live/test/webhook/private key/PAT minta nem talált |
| Böngészős capability regresszió | helyi success route szintetikus fragmenttokennel | **PASS:** token eltűnt a látható URL-ből; `no-referrer`; route renderelt |
| Élő frontend | HTTPS/HTTP/header/bundle ellenőrzés 2026-07-14 | HTTPS 200 és HTTP→HTTPS redirect; **security headerek hiányosak**, bundle workers.dev originre mutat |
| Élő custom API | `GET /api/health` | **RÉSZBEN JAVÍTVA:** DNS/TLS/Worker routing rendben, a korábbi 522 megszűnt; **FAIL: HTTP 503 degraded** hiányos production runtime konfiguráció miatt |
| Élő workers.dev API | `GET /api/health` | **FAIL: HTTP 503 degraded** |
| Lint | root `npm run lint` implementációja | Csak typecheck; **valódi ESLint nincs**, ezért részben teljesített |
| Config validation | kód/workflow + lokális név/jelenlét ellenőrzés, értékek nélkül | Kód fail-closed; workflow YAML **PASS**; helyi payment env **INCOMPLETE**; távoli production **nem jó**, health degraded |
| Static security analysis | Semgrep/CodeQL | Nem futott: CLI/workflow nincs telepítve. Javasolt: `semgrep scan --config p/typescript --config p/owasp-top-ten --error`; siker = 0 nem triage-olt High/Critical |
| History-grade secret scanner | gitleaks | CLI nincs telepítve. Javasolt: `gitleaks git --redact --exit-code 1`; siker = 0 valódi secret, csak dokumentált teszt allowlist |
| Docker image scan | Trivy/Grype | **N/A:** nincs Dockerfile/image. Ha később lesz: `trivy image --severity HIGH,CRITICAL --exit-code 1 <image>` |
| Wrangler dry-run/remote config | valódi generated `wrangler.toml` + account | Nem futott teljesen: nincs audit számára használható production credential/config. Siker = dry-run zöld, helyes D1/KV/Worker target, majd health 200 |
| Live provider E2E | Stripe/Számlázz/Gemini/Resend | Szándékosan nem futott: valódi fizetést és ügyféladatot nem használhattam. Külön staging secretek és erőforrások szükségesek. |

Megjegyzés: a teljes suite az audit során alkalmazott alacsony kockázatú hardening után ismét lefutott. A korábbi célzott tesztparancs egyszer hibás workspace-relatív fájlút miatt „No test files found” eredményt adott; a helyes paranccsal 9/9 célzott teszt, majd a teljes suite is sikeres volt. Ez nem termékhiba.

## 9. Manuális tesztterv

Minden payment teszt Stripe test módban, külön staging D1-en, Számlázz.hu tesztfiókkal és szintetikus személyes adattal fusson. Live smoke csak külön jóváhagyással, előre rögzített refund/számlakorrekciós eljárással.

| Teszt | Lépés | Elvárt eredmény / bizonyíték |
|---|---|---|
| Sikeres fizetés | Stripe test kártya, helyes csomag | webhook verified; pontosan 1 paid transition, 1 AI activation, 1 invoice; result elérhető tokennel |
| Sikertelen fizetés | decline test kártya / async failure | nincs entitlement/AI/invoice; failed státusz; értesítés idempotens |
| Módosított kliensár | requestbe `price`, `amount`, más currency/package adat | 400; Stripe API nem hívódik; audit event PII nélkül |
| Hamis webhook | hibás/hiányzó signature és régi timestamp | 400; event nincs claimelve; order változatlan |
| Ismételt webhook | azonos event ID és más event ugyanarra az orderre | nincs dupla paid/AI/invoice/credit; completed duplicate 200, in-progress retryable |
| Refund | partial és full test refund | összeg/státusz helyes; full refundnál result/regen letilt; számlakorrekció workflow létrejön |
| Subscription cancellation | jelenlegi aktív csomagoknál **N/A**; dormant subscription aktiválása előtt | külön design és teszt szükséges; cancellation után quota/entitlement megszűnik a period policy szerint |
| Dispute/chargeback | Stripe test dispute event replay | dispute rekord idempotens; access azonnal tiltott open/lost állapotban; won policy tesztelt |
| Jogosulatlan API | result/regen/send/admin token nélkül/rossz tokennel | 401/403; PII és erőforrás-létezés nem szivárog indokolatlanul |
| Más felhasználó erőforrása / IDOR | A public ID + B token párosítása | 401; sem result, sem regen/send/cancel nem működik |
| Lejárt session/token | exchange-flow után TTL; jelenleg token expiry hiánya finding | lejárt token 401; active token működik; revoke azonnali |
| Rate limit | limit+1 soros és 100 párhuzamos kérés IP/e-mail/admin scope-on | dokumentált limit, 429, atomi számlálás, normál user recovery ablak után |
| AI timeout | mock/provider 25 s feletti késés | kontrollált failure; véges retry; order nem ragad; cron refund egyszer |
| AI hibás válasz | üres, malformed, túl hosszú, control char, review fail | nem kerül megbízható outputként DB/UI-ba; javítás vagy refund policy fut |
| Túl hosszú prompt | mezőnként és összesen limit felett | 400 Zod error generikus üzenettel; Gemini nem hívódik |
| Prompt injection | taglezárás, indirect injection előzményben, HTML/SQL/shell kérés | output plain text; nincs tool/action; policy/review blokkol vagy biztonságos levél készül |
| Korlátlan AI usage kísérlet | több IP/e-mail, párhuzamos regen, duplicate request | fizetés nélküli generation nincs; per-order regen atomi; provider budget alert megszólal |
| Adatbázis-kiesés | D1 binding hiba/503 szimuláció | health 503; checkout nem tölt; webhook 500-zal retryable; nincs részleges entitlement |
| Hiányzó/hibás env | egyes kötelező secret/binding eltávolítása stagingen | deploy/preflight vagy runtime guard fail-closed; secretérték nem logolódik |
| Log secret/PII mentesség | teljes tesztforgalom export és scanner | nincs API key, bearer, result token, prompt/letter, e-mail, IP, számlázási cím/adószám |
| E-mail provider hiba | 400, 500, timeout, duplicate idempotency key | body nem logolódik; timeout véges; invoice állapot nem vész el; retry nem duplikál |
| Számlázó hiba | timeout, invalid tax, „already exists”, hiányos response | reconcile idempotens; max retry; admin alert; nincs dupla számla |
| CORS/CSRF-szerű böngészőteszt | idegen origin POST/OPTIONS; same-origin valid | idegen origin 403; webhook origin nélkül is signature alapján működik; bearer nélkül nincs művelet |

## 10. Production readiness checklist

### Security

- [x] Szerveroldali strict inputvalidáció, body limit, paraméterezett SQL
- [x] API security headerek és exact CORS allowlist
- [ ] Frontend HTTP security headerek
- [x] Production admin API fail-closed tiltva; production `workers_dev=false` a generált configban
- [ ] Identity-aware Access/MFA és actor audit az admin API bármely későbbi engedélyezése előtt
- [ ] SAST + history-grade secret scan kötelező CI check

### Payments

- [x] Szerveroldali ár/csomag/pénznem
- [x] Verified raw-body webhook és idempotens event claim
- [x] Failed/expired/refund/dispute state kezelés kódban és unit/integration tesztben
- [ ] Stripe staging/live webhook E2E és dashboard monitoring
- [ ] Refund/storno/helyesbítő számla könyvelő által jóváhagyva

### AI API

- [x] Kulcs csak backendben; token/output/timeout/retry korlátozott
- [x] Fizetett order és regeneration quota
- [x] Történeti kulcs revoke + restricted paid production key — projektgazda által megerősítve 2026-07-18-án
- [ ] Budget/quota alert, logging policy és DPA
- [x] Prompt delimiter escaping és injection regressziós teszt
- [ ] PII-minimalizálás, provider DPA/logging policy és szélesebb adversarial corpus

### Authentication

- [x] Order private endpointok capability tokent ellenőriznek; token hash tárolt
- [x] IDOR negatív tesztek
- [x] Új result token URL fragmentben, azonnali URL scrubbal és `no-referrer` policyvel
- [ ] Single-use exchange + expiry/revoke
- [ ] Admin identity, MFA, scope és audit actor

### Database

- [x] D1 migrációk és integrity dry-run
- [x] Paraméterezett queryk, payment/idempotency állapotok
- [x] Jogi elfogadás ideje és dokumentumverziói az additív 0011 migrációban
- [ ] Production D1 least-privilege deploy scope review
- [ ] Restore drill és forward-compatible migration policy

### Secrets

- [x] Placeholder-only `.env.example`, lokális secret fájlok gitignore + `0600`
- [x] Frontend bundle-ben nem találtam server secretet
- [x] Történeti AI-kulcs revoke/usage audit — projektgazda által megerősítve 2026-07-18-án
- [ ] Minden production secret létrehozva, környezetenként külön és inventoryzott
- [ ] Távoli stale secret törlés automatizált

### Deployment

- [x] Build/typecheck/test workflow létezik
- [x] Post-deploy health/security-header gate és automatikus Worker rollback kódban
- [x] D1 Time Travel bookmark artifact migráció előtt
- [ ] Staging remote run, rollback és D1 restore drill bizonyítéka
- [ ] Külön E2E staging frontend

### Domain és HTTPS

- [x] Frontend HTTP→HTTPS redirect működik
- [ ] Custom API domain 200 és stabil
- [ ] HSTS/CSP/frame headerek a frontenden
- [ ] Turnstile/Resend DNS és hostname restriction igazolt

### Monitoring

- [ ] Health synthetic és Cloudflare alert
- [ ] Stripe webhook failure/backlog alert
- [ ] Gemini költség/kvóta alert
- [ ] Admin auth failure és abuse alert

### Backups

- [x] D1 Time Travel/bookmark pre-deploy workflow-ban
- [ ] Restore RPO/RTO dokumentált és próbált
- [ ] Backup retention összhangban a törlési/retention policyval

### Logging

- [x] Strukturált log és secret redaction
- [x] Rate-limit identifier és Resend response body eltávolítva
- [ ] Centralizált retention, correlation ID és actor audit
- [ ] Staging log PII/secret scanner zöld

### Testing

- [x] 322/322 teljes teszt, 66/66 payment smoke, build/typecheck/lint
- [ ] Friss online npm audit CI-ben zöld (helyben csak az offline cache-audit futott)
- [ ] Valódi staging provider E2E
- [ ] Concurrency/rate-limit, restore és incident drill

### Legal és privacy

- [x] Privacy/terms oldalak és 90 napos tartalomredakció alapja létezik
- [ ] Magyar jogász/könyvelő review
- [x] Terms/privacy verzió és elfogadási idő technikailag tárolt
- [ ] Publikált verzióazonosítók jogi jóváhagyása
- [ ] DSAR export/törlés és teljes retention mátrix
- [ ] Processor DPA-k és adattranszferek dokumentálva

### Rollback

- [ ] Előző Worker version rögzítve és próbált
- [ ] Előző frontend artifact/commit visszatelepíthető
- [ ] D1 migration rollback/forward-fix döntési fa próbált

### Incident response

- [ ] Secret leak, payment, PII és AI spend playbook
- [ ] Owner/on-call és kommunikációs lista
- [ ] Kulcsrotáció és webhook replay drill
- [ ] Bizonyítékmegőrzési és értesítési döntési folyamat

## 11. Deployment és rollback terv

### Ajánlott kiadási sorrend

1. **Freeze és bizonyíték:** H-02 projektgazdai lezárás rögzítve; release commit/tag; dependency és secret scan; production config kétszemélyes review.
2. **Staging infrastruktúra:** külön D1/KV/Worker/frontend, Stripe test webhook, Számlázz.hu test account, Gemini staging key, Resend/Turnstile staging konfiguráció.
3. **Staging deploy:** minden migráció új/klónozott D1-en; health; teljes 9. fejezet szerinti E2E; log PII/secret scan.
4. **Production restore point:** D1 Time Travel bookmark és aktuális Worker version ID; előző frontend artifact/tag; webhook queue állapot rögzítése.
5. **Expand migration:** csak backward-compatible séma. Destruktív drop/rename külön későbbi release-ben, amikor minden régi Worker verzió kikerült.
6. **Worker deploy:** production secrets/bindings exact inventory; deploy; custom API `/api/health`; CORS; read-only és sandbox-safe smoke. Health hiba esetén frontend deploy tilos.
7. **Webhook ellenőrzés:** Stripe endpoint delivery és signature; teszt replay; nincs in-progress/failed backlog.
8. **Frontend deploy:** kizárólag custom API origin, demo false; header ellenőrzés; success/cancel route és Turnstile.
9. **Megfigyelés:** legalább 60 perc fokozott health, 5xx, webhook, D1, AI, invoice és e-mail monitoring; kis forgalmi canary, ha a platform támogatja.
10. **Release lezárása:** acceptance bizonyíték, owner, ismert maradék P1/P2 határidő.

### Rollback

- **Worker kód/config hiba:** azonnal az előző Cloudflare Worker versionre; a webhook endpoint maradjon 2xx/5xx konzisztens, eseményt ne manuálisan jelöljünk completednek.
- **Frontend hiba:** előző ismert jó GitHub Pages/hosting artifact vagy release commit redeploy; API backward compatibility maradjon.
- **Migráció hiba adatváltozás nélkül:** Worker rollback + forward-fix migration. SQL „down” csak stagingen próbált, bizonyított esetben.
- **Adatkárosító migráció:** forgalom/payment ideiglenes leállítása; D1 Time Travel restore egy új DB-be, integritásellenőrzés, binding atomikus átállítása; Stripe webhook események kontrollált replay-e idempotency mellett.
- **Secret incidens:** érintett kulcs revoke, új kulcs deploy, usage/log review. `TOKEN_HASH_SECRET` cseréje minden aktív result tokent invalidál, ezért kommunikációs és grace/migration terv nélkül nem forgatható.
- **Rollback acceptance:** RTO cél és döntéshozó előre rögzített; restore után health, DB integrity, egy known order read, webhook duplicate és payment state smoke zöld.

## 12. Végső döntés: `NO-GO`

Az alkalmazás **még nem adható ki biztonságosan productionbe**. A történeti AI-kulcs incidensstátusza projektgazdai megerősítés alapján lezárt, de az élő API továbbra is 503, az új deployment/rollback/restore gate-eket még nem futtatták le stagingen, és a fennmaradó production secretek/külső szolgáltatói beállítások nincsenek igazoltan telepítve. A statikus-tokenes admin felület productionben most tiltott, ezért már nem önálló nyitott kódszintű blocker.

A döntés `CONDITIONAL GO` szintre akkor emelhető, ha minden fennmaradó P0 acceptance criteria bizonyítottan teljesült, nincs nyitott Critical, az API health stabil, az admin felület Access mögött vagy kikapcsolva, és a teljes staging E2E zöld. `GO` csak akkor indokolt, ha a High production blockerek lezárultak, a kötelező provider/payment/AI manuális tesztek sikeresek, és a production secret/config inventory kétszemélyesen jóváhagyott.

## Teendők Patrik számára

1. **Google AI Studio / Cloud Console:** keresd meg és vond vissza a Git-historyban talált régi AI-kulcsot; nézd át a usage logot; hozz létre külön paid production projektet és restricted `GEMINI_API_KEY`-t; állíts budget/quota alertet és kapcsold ki/minimalizáld a prompt loggingot.
2. **Cloudflare:** hozd létre/ellenőrizd a külön staging és production Workert, D1-et és KV-t; javítsd az `api.xn--gyfelszolgalat-fsb.hu` custom domaint; futtasd le az új workflow-t, amely productionben tiltja a workers.dev origint; hozz létre Turnstile prod/staging widgetet. Cloudflare Access admin policy és MFA csak az admin API későbbi engedélyezéséhez kell.
3. **Stripe:** a live Dashboardban hozz létre/ellenőrizd a live secret keyt és a `https://api.xn--gyfelszolgalat-fsb.hu/api/stripe/webhook` endpointot; vedd fel a checkout completed/failed/expired, payment failed, refund/charge és dispute eseményeket; a kapott endpoint secret külön production `STRIPE_WEBHOOK_SECRET` legyen. Publishable key nem kell ehhez a Hosted Checkout implementációhoz.
4. **Számlázz.hu:** a Vezérlőpult → Számla Agent Kulcsok részen legyen külön teszt- és live `SZAMLAZZ_AGENT_KEY`; könyvelővel ellenőrizd a seller adatokat, az AAM státuszt, valamint a refund/storno/helyesbítő folyamatot.
5. **Resend/DNS:** verifikáld a küldő domaint (SPF, DKIM, DMARC), hozz létre send-only `RESEND_API_KEY`-t, és állítsd be a verified `EMAIL_FROM` értéket; kapcsold be bounce/complaint monitoringot.
6. **GitHub Environment – production secrets:** add meg `CLOUDFLARE_API_TOKEN`, `GEMINI_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `TURNSTILE_SECRET_KEY`, `TOKEN_HASH_SECRET`, `SZAMLAZZ_AGENT_KEY`, `RESEND_API_KEY`. **Ne adj meg** `ADMIN_API_TOKEN`-t vagy `DEMO_ACCESS_CODE`-ot productionben. Ugyanezekből staginghez külön érték kell; secretértéket ne használj repository variable-ként.
7. **GitHub Environment – production variables:** add meg `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_D1_DATABASE_ID`, `CLOUDFLARE_KV_NAMESPACE_ID`, `D1_DATABASE_NAME`, `WORKER_NAME`, `API_HEALTH_URL`, `SITE_URL`, `ALLOWED_ORIGINS`, `TURNSTILE_EXPECTED_HOSTNAMES`, `LEGAL_TERMS_VERSION`, `PRIVACY_POLICY_VERSION`, `ADMIN_API_ENABLED=false`, a három Gemini model ID-t, `EMAIL_FROM`-ot és a seller adatokat. A frontend environmentben add meg `VITE_API_BASE_URL=https://api.xn--gyfelszolgalat-fsb.hu`, `VITE_SITE_URL=https://xn--gyfelszolgalat-fsb.hu`, `VITE_BASE_PATH=/`, `VITE_TURNSTILE_SITE_KEY`, `VITE_DEMO_MODE=false` értékeket.
8. **Domainek/redirectek:** frontend origin `https://xn--gyfelszolgalat-fsb.hu`; API origin `https://api.xn--gyfelszolgalat-fsb.hu`; CORS allowlist csak a tényleges frontend originek. A Stripe success/cancel útvonalak `https://xn--gyfelszolgalat-fsb.hu/sikeres-fizetes` és `/sikertelen-fizetes`; OAuth redirect nincs. Turnstile allowed hostname-ba csak a tényleges frontend host és külön staging host kerüljön.
9. **Rotáció:** a történeti AI-kulcs visszavonása és cseréje projektgazdai megerősítés alapján elkészült. Minden más ismeretlen eredetű vagy korábban megosztott Stripe/Resend/Turnstile/Számlázz/Cloudflare kulcsot cserélj ki kiadás előtt. `TOKEN_HASH_SECRET` csak tervezetten cserélhető, mert aktív linkeket érvénytelenít. Production `ADMIN_API_TOKEN` ne legyen.
10. **Manuális release gate:** először stagingen futtasd végig a 9. fejezet payment, hamis/dupla webhook, refund/dispute, IDOR, rate-limit, AI timeout/injection, DB outage, env failure és logtisztaság tesztjeit. Production deployt csak custom API health 200, post-deploy smoke és kipróbált rollback után engedj.
