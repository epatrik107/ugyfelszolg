# Stripe + Számlázz.hu payment/billing runbook

## Hatókör és üzleti szabályok

- A checkout kizárólag B2C, magyarországi magánszemély vásárlót fogad.
- A `buyerType` egyetlen elfogadott értéke `individual`.
- Cégnév, adószám, VAT/EU VAT ID, szervezeti buyer type és szervezetet jelző számlázási név elutasításra kerül.
- A kliens nem küldhet árat, pénznemet, kupont vagy kedvezményt. A fizetendő bruttó HUF összeg kizárólag a backend csomagkatalógusából származik.
- A jelenlegi szolgáltatás nem támogat kupont vagy promóciót (`discountAmount = 0`).
- A piac HU-only, mert az ár 27% magyar ÁFÁ-t tartalmaz. Külföldi fogyasztó addig nem engedhető, amíg az OSS/célországi ÁFA szabály nincs implementálva.
- Aktiválás és számlázás kizárólag Stripe által aláírt, szerveroldalon visszaolvasott, `paid` állapotú, pontos összegű és pénznemű Checkout Session után indul.
- `failed`, `cancelled`, `expired`, `amount_mismatch` és `currency_mismatch` állapotban nincs aktiválás és nincs számla.

## Stripe flow

1. A frontend egy UUID `checkoutAttemptId`-t küld a szigorúan validált B2C adatokkal.
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
- A vevő `<adoalany>-1</adoalany>` (nincs adószám); `<adoszam>`, `<adoszamEU>` és céges mező nincs a payloadban.
- HUF B2C kerekítés bruttó alapú: `áfa = round(bruttó / 127 * 27)`, `nettó = bruttó - áfa`.
- A `szamlaKulsoAzon` és `rendelesSzam` az order ID. Ambiguus timeout után a retry előbb ezzel az azonosítóval kérdezi le a már elkészült számlát, így nem állít ki duplikátumot.
- Retry-olható hiba `retry_required`, legfeljebb 5 próbálkozás, 5/30/120/720 perces backoff. Validáció/auth hiba `failed`, kézi javítást igényel.
- Az ütemezett Worker feldolgozza a due és stale invoice állapotokat. A fizetés közben végig `paid` marad.
- A Számlázz.hu vevői fiók/PDF linkje, ha érkezik, D1-be kerül; a Számlázz.hu küldi ki az e-számlát a validált számlázási emailre.

## Refund szabály

- Teljes és részleges refund külön payment státuszt kap.
- Ha már készült számla, `refund_invoice_status=manual_required` lesz és monitoring esemény készül.
- Automatikus sztornó/helyesbítő számla nincs engedélyezve, amíg a pénzügyi/jogi szabály (teljes vs. részleges refund, teljesítési állapot) nincs jóváhagyva. Productionben ezt adminnak kell rendeznie Számlázz.hu-ban.

## Production előtti checklist

1. Töltse ki és jogásszal ellenőriztesse az ÁSZF/adatkezelés `[KITÖLTENDŐ]` szolgáltatói mezőit.
2. Állítsa be a live `STRIPE_SECRET_KEY`, live endpoint `STRIPE_WEBHOOK_SECRET` és live `SZAMLAZZ_AGENT_KEY` GitHub/Worker secreteket. Test és live kulcsot ne keverjen.
3. Stripe Workbenchben csak a dokumentált eseményeket kapcsolja az endpointhez.
4. Számlázz.hu tesztfiókkal, Stripe test mode-dal végezzen kézi smoke tesztet; valódi kártyát és production adatot ne használjon.
5. Ellenőrizze a számlaképet, eladói adatokat, 27% ÁFÁ-t, email-kézbesítést és a Számlázz.hu tesztfiók kikapcsolását csak a jóváhagyott go-live pillanatban.
6. Alkalmazza a D1 migrációkat a Worker deploy előtt. Ne deployoljon mainen kívüli automatikával és ne merge-eljen ellenőrzés nélkül.
7. Monitorozza: `payment_paid`, `payment_failed`, `duplicate_webhook_ignored`, `amount_mismatch`, `currency_mismatch`, `invoice_pending`, `invoice_created`, `invoice_retry_finished`, `refund_invoice_manual_required`, `rejected_business_buyer_attempt`, `rejected_tax_number_attempt`, `rejected_manipulated_price`.
