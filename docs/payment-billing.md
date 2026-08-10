# Stripe + Számlázz.hu payment/billing runbook

## Hatókör és üzleti szabályok

- A checkout magyarországi magánszemély és magyar adószámmal rendelkező céges vásárlót fogad.
- A `buyerType` elfogadott értékei: `individual` és `business`.
- Céges vásárlónál a cégnév és magyar adószám kötelező; VAT/EU VAT ID, nem támogatott szervezeti buyer type és kliensoldali adó/ármező elutasításra kerül.
- A kliens nem küldhet árat, pénznemet, kupont vagy kedvezményt. A fizetendő HUF végösszeg kizárólag a backend csomagkatalógusából származik.
- A jelenlegi szolgáltatás nem támogat kupont vagy promóciót (`discountAmount = 0`).
- A seller igazolt adózási státusza AAM (alanyi adómentes). A Számlázz.hu tételben az áfakulcs `AAM`, a nettó és bruttó érték megegyezik, az áfa összege 0.
- A Stripe csak a fizetést dolgozza fel: Stripe Tax és Stripe invoice creation nincs engedélyezve, a Checkout inline Price nem kap `tax_behavior` értéket. A jogszabályi számlát kizárólag a Számlázz.hu állítja ki.
- A piac HU-only. Külföldi fogyasztó addig nem engedhető, amíg a határon átnyúló adózási szabályok nincsenek implementálva és szakértővel jóváhagyva.
- Aktiválás és számlázás kizárólag Stripe által aláírt, szerveroldalon visszaolvasott, `paid` állapotú, pontos összegű és pénznemű Checkout Session után indul.
- A `PAYMENT_MODE=test|live` explicit környezetválasztás kötelező. A Stripe secret kulcs prefixének és a webhook `livemode` jelzőjének egyeznie kell vele.
- Fizetős deployban a demó bypass tiltott: `DEMO_MODE=true` és `PAYMENTS_ENABLED=true` kombinációt a Worker hibás konfigurációnak kezeli.
- `failed`, `cancelled`, `expired`, `amount_mismatch` és `currency_mismatch` állapotban nincs aktiválás és nincs számla.

## Stripe flow

1. A frontend egy UUID `checkoutAttemptId`-t küld a szigorúan validált számlázási adatokkal.
2. D1 egyedi index és Stripe `Idempotency-Key` védi a retry/double-click versenyhelyzetet.
3. A Worker állítja elő az árat, a line itemet és a metadata engedélyezett mezőit (`orderId`, `publicId`, `selectedPackage`). Számlázási vagy céges adat nem kerül metadata-ba.
4. A Checkout kizárólag `card` fizetési módot használ; a hosted Checkout kezeli az SCA/3DS folyamatot.
5. A webhook nyers törzsön HMAC-SHA256 signature és 5 perces timestamp tolerance ellenőrzést végez.
6. Az esemény `processing/completed/failed` állapottal kerül D1-be. Feldolgozási hiba 500 választ ad, így Stripe újraküldi az eseményt.
7. A Worker a Checkout Sessiont Stripe-tól visszaolvassa, majd order/session/package/amount/currency/mode/payment-status egyezést ellenőriz.
8. A `markOrderPaid` feltételes adatbázis-művelet; duplikált vagy eltérő event ID sem aktivál kétszer.

## Számlázási flow

- Sikeres fizetéskor az order `invoice_status=pending` lesz; az aktiválás ettől függetlenül elindul.
- A számlázási worker atomikusan `processing` állapotot foglal. Párhuzamos webhook csak az egyik hívást engedi a providerhez.
- A Számla Agent kérés hivatalos `action-xmlagentxmlfile` multipart mezőt és aktuális XSD-sorrendet használ.
- Magánszemély vevőnél `<adoalany>-1</adoalany>` kerül a payloadba; céges vevőnél a validált magyar `<adoszam>` kerül átadásra. `<adoszamEU>` nincs támogatva.
- AAM HUF számlán `nettó = fizetendő végösszeg`, `áfa = 0`, `bruttó = fizetendő végösszeg`, az XML `<afakulcs>` értéke `AAM`.
- Az AAM státusz nem runtime environment variable: megváltoztatása kódreview-t, tesztfrissítést, jogi/könyvelői ellenőrzést és új release-t igényel.
- A `szamlaKulsoAzon` és `rendelesSzam` az order ID. Ambiguus timeout után a retry előbb ezzel az azonosítóval kérdezi le a már elkészült számlát, így nem állít ki duplikátumot.
- Retry-olható hiba `retry_required`, legfeljebb 5 próbálkozás, 5/30/120/720 perces backoff. Validáció/auth hiba `failed`, kézi javítást igényel.
- Az ütemezett Worker feldolgozza a due és stale invoice állapotokat. A fizetés közben végig `paid` marad.
- A Számlázz.hu vevői fiók/PDF linkje, ha érkezik, D1-be kerül; live módban a Számlázz.hu küldi ki az e-számlát a validált számlázási emailre. Teszt/sandbox módban a Számlázz.hu emailküldés kényszerítetten tiltott.
- Admin API-n keresztül lekérdezhető a számla státusza, retry-zhető a sikertelen számlakészítés és retry-zhető a sikertelen számlaemail küldés. Az admin endpointok `ADMIN_API_TOKEN` bearer tokennel védettek.
- `PAYMENT_MODE=test` esetén a Számlázz.hu vevői email küldése kényszerítetten ki van kapcsolva, és `SZAMLAZZ_TEST_ACCOUNT_CONFIRMED=true` szükséges.

## Refund szabály

- Teljes és részleges refund külön payment státuszt kap.
- Chargeback/dispute eseménynél a rendelés `chargeback_open`, `chargeback_lost` vagy `chargeback_won` státuszt kap, és az esemény a `payment_disputes` audit táblába kerül.
- Ha már készült számla, `refund_invoice_status=manual_required` lesz és monitoring esemény készül.
- Automatikus sztornó/helyesbítő számla nincs engedélyezve, amíg a pénzügyi/jogi szabály (teljes vs. részleges refund, teljesítési állapot) nincs jóváhagyva. Productionben ezt adminnak kell rendeznie Számlázz.hu-ban.

## Production előtti checklist

1. Ellenőrizze jogásszal az ÁSZF/adatkezelés szolgáltatói adatait, a panaszkezelési eljárást és a 90 napos személyes tartalom redaction szabályt.
2. Állítsa be a live `STRIPE_SECRET_KEY`, live endpoint `STRIPE_WEBHOOK_SECRET` és live `SZAMLAZZ_AGENT_KEY` GitHub/Worker secreteket. Test és live kulcsot ne keverjen.
3. Stripe Workbenchben csak a dokumentált eseményeket kapcsolja az endpointhez.
4. Számlázz.hu tesztfiókkal, Stripe test mode-dal végezzen kézi smoke tesztet; valódi kártyát és production adatot ne használjon.
5. Ellenőrizze a számlaképet, eladói adatokat, az `AAM` áfakulcsot, a nettó=bruttó és áfa=0 összegeket, az email-kézbesítést és a Számlázz.hu tesztfiók kikapcsolását csak a jóváhagyott go-live pillanatban.
6. Alkalmazza a D1 migrációkat a Worker deploy előtt. Ne deployoljon mainen kívüli automatikával és ne merge-eljen ellenőrzés nélkül.
7. Monitorozza: `payment_paid`, `payment_failed`, `duplicate_webhook_ignored`, `amount_mismatch`, `currency_mismatch`, `chargeback_dispute_recorded`, `invoice_pending`, `invoice_created`, `invoice_retry_finished`, `invoice_email_sent`, `invoice_email_send_failed`, `admin_invoice_retry`, `admin_invoice_email_retry`, `refund_invoice_manual_required`, `rejected_tax_number_attempt`, `rejected_manipulated_price`.

A GitHub sandbox/production secret- és deploy-konfiguráció részletes leírása: [github-environments.md](github-environments.md).
