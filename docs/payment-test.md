# Helyi Stripe + Számlázz.hu teszt

Ez a folyamat kizárólag Stripe sandbox/test módot és külön Számlázz.hu tesztfiókot használ. Valódi bankkártyát, `sk_live_` kulcsot vagy éles Számlázz.hu Agent kulcsot tilos használni.

## Biztonságos kulcskezelés

- Secretet ne küldj chatben, issue-ban vagy commitban.
- A Stripe `sk_test_…`, a Stripe CLI által kiírt `whsec_…` és a Számlázz.hu tesztfiók kisbetűs Agent kulcsa csak a gitignore-olt `worker/.dev.vars` fájlba kerüljön.
- A frontendbe Stripe secret vagy Agent kulcs soha nem kerülhet.
- Teszt módban a Worker letiltja a Számlázz.hu vevői email-küldését.
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
7. Ellenőrizd a Számlázz.hu tesztfiókban a nevet, címet, HUF összeget és 27% ÁFÁ-t, valamint hogy nincs cégnév/adószám/VAT ID.
8. Ellenőrizd, hogy a rendszer nem küldött valódi emailt.

A Számlázz.hu tesztkörnyezet dokumentált limitje maximum 100 tesztszámla óránként.
