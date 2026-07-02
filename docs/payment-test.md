# Helyi Stripe + Számlázz.hu teszt

Ez a folyamat kizárólag Stripe sandbox/test módot és külön Számlázz.hu tesztfiókot használ. Valódi bankkártyát, `sk_live_` kulcsot vagy éles Számlázz.hu Agent kulcsot tilos használni.

## Biztonságos kulcskezelés

- Secretet ne küldj chatben, issue-ban vagy commitban.
- A Stripe `sk_test_…`, a Stripe CLI által kiírt `whsec_…` és a Számlázz.hu tesztfiók kisbetűs Agent kulcsa csak a gitignore-olt `worker/.dev.vars` fájlba kerüljön.
- A frontendbe Stripe secret vagy Agent kulcs soha nem kerülhet.
- Teszt módban a Worker letiltja a Számlázz.hu vevői email-küldését.
- Tranzakciós emailt kizárólag sandbox email providerrel tesztelj. Resend esetén a `RESEND_API_KEY` sandbox secret, az `EMAIL_FROM` pedig sandbox environment variable legyen validált teszt feladóval.
- `PAYMENT_MODE=test` mellett a Worker elutasítja az `sk_live_…` kulcsot és a `livemode=true` webhook eseményt.

Kiinduló minták:

```bash
cp frontend/.env.local.example frontend/.env.local
```

A `worker/.dev.vars.example` hiányzó sorait másold a már létező `worker/.dev.vars` végére, majd töltsd ki helyben a placeholder értékeket. A meglévő Gemini- és token-secreteket ne írd felül.

Számlázz.hu-ban előbb kapcsold be vagy hozz létre a tesztfiókot, és kizárólag annak Agent kulcsát használd. A `SZAMLAZZ_TEST_ACCOUNT_CONFIRMED=true` ennek explicit biztonsági megerősítése; önmagában nem alakít át egy éles fiókot tesztfiókká.

## Stripe CLI és webhook

macOS alatt:

```bash
brew install stripe/stripe-cli/stripe
stripe login
```

Ezután külön terminálban:

```bash
stripe listen \
  --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,payment_intent.payment_failed,checkout.session.expired,charge.refunded \
  --forward-to http://127.0.0.1:8787/api/stripe/webhook
```

A parancs által kiírt `whsec_…` értéket tedd a `worker/.dev.vars` `STRIPE_WEBHOOK_SECRET` mezőjébe. Minden új `stripe listen` indítás után ellenőrizd ezt az értéket.

## Indítás

Konfiguráció ellenőrzése — secreteket nem ír ki:

```bash
npm run test:payment-env
```

Lokális D1:

```bash
npx wrangler d1 migrations apply ugyfelkozpont --local --config worker/wrangler.toml
```

Worker és frontend két külön terminálban:

```bash
npm run dev --workspace worker
```

```bash
npm run dev --workspace frontend
```

Nyisd meg: `http://localhost:5173`.

## Kézi tesztesetek

Minden Stripe tesztkártyához használható jövőbeli lejárat, tetszőleges háromjegyű CVC és valós formátumú, de nem valódi számlázási adat.

1. Sikeres fizetés: `4242 4242 4242 4242`.
2. 3D Secure sikeres challenge: `4000 0000 0000 3220`.
3. 3D Secure utáni elutasítás: `4000 0084 0000 1629`.
4. A Stripe Checkout bezárásával ellenőrizd a cancelled flow-t.
5. Ismételd meg ugyanazt a webhook eventet; nem készülhet második számla vagy aktiválás.
6. Paid rendelésen új checkout nem indulhat.
7. Ellenőrizd a Számlázz.hu tesztfiókban a nevet vagy céges nevet, címet, magyar adószámot céges vevőnél, HUF összeget és 27% ÁFÁ-t, valamint hogy VAT/EU VAT ID nem kerül a számlára.
8. Ha `RESEND_API_KEY` és `EMAIL_FROM` be van állítva sandboxban, ellenőrizd, hogy a megadott vevői email címre megérkezik:
   - az elkészült generált levél szövege;
   - a számlaértesítő, Számlázz.hu PDF/link adattal, ha a szolgáltató visszaadta.
9. Ha sandbox email provider nincs beállítva, ellenőrizd, hogy a fizetés, aktiválás és számlázás email nélkül is sikeresen végigmegy.

A Számlázz.hu tesztkörnyezet dokumentált limitje maximum 100 tesztszámla óránként.

## Apple Pay és Google Pay sandbox ellenőrzés

A rendszer Stripe Hosted Checkoutot használ. A Worker kifejezetten `payment_method_types=['card']` értéket küld, hogy a checkout kártyás fizetésre korlátozódjon. A Stripe Hosted Checkout ezen belül jogosult böngészőben/eszközön Apple Payt és Google Payt is meg tud jeleníteni card walletként.

Ellenőrzési lépések:

1. Stripe sandboxban a Payment methods beállításoknál engedélyezd a wallet fizetéseket a card payment methodhoz.
2. Apple Pay teszthez használj támogatott Apple eszközt/Safarit, Apple Walletben mentett tesztelhető kártyával.
3. Google Pay teszthez használj Chrome-ot, Google Payre alkalmas profilt és engedélyezett mentett fizetési mód ellenőrzést.
4. Ne privát/incognito ablakban tesztelj.
5. Indíts sandbox checkoutot, majd ellenőrizd, hogy a Stripe Checkout oldalon jogosult környezetben megjelenik az Apple Pay vagy Google Pay opció.
6. Ha a Stripe demóban látszik a wallet, de a saját Checkoutban nem, ellenőrizd a Stripe Payment Method Domains beállítást külön sandbox és live környezetre is.

Apple Pay / Google Pay megjelenése böngésző-, eszköz-, régió- és walletfüggő, ezért ezt nem lehet megbízhatóan headless CI-ból bizonyítani. A CI azt védi, hogy a backend kártyás Checkout Sessiont hozzon létre, ami wallet-kompatibilis, és közben ne engedjen nem-kártyás fizetési módokat véletlen Dashboard konfigurációból.
