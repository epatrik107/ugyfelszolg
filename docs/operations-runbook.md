# Üzemeltetési runbook

## Mi riaszt, és hová

| Csatorna | Mikor jelez | Független a Resendtől? |
|---|---|---|
| Üzemeltetői összesítő email (`OPERATOR_EMAIL`) | 5 percenként ellenőriz; új problémánál azonnal, változatlan állapotnál naponta egyszer | nem |
| `Ops watch` GitHub workflow (óránként) | health hiba, 10 percnél régebbi cron heartbeat, kézbesíthetetlen riasztó email, 1 óránál régebben hibázó Stripe webhook, hibás Stripe webhook-endpoint konfiguráció | igen (GitHub email a sikertelen futásról) |
| Kapcsolati űrlap értesítés (`OPERATOR_EMAIL`, a válasz a feladónak megy) | minden új üzenetnél | nem |

Az összesítő email témái:
- kézi refund, lezáratlan Stripe refund, sztornó
- végleg sikertelen vagy 6 órája késő számla
- webhook-hiba, fizetési anomália, nyitott chargeback
- torlódó vagy újrapróbált generálás, 24 órán belüli sikertelen generálás
- dead-letter email, sikertelen operátori művelet

Csak rendelési public ID-kat és Stripe objektumazonosítókat tartalmaz.

## Operátori műveletek

GitHub → Actions → **Operator action** → `production`.

- **Hozzáférés:** repository írási jog és a `production` environment védelme.
- **Végrehajtás:** a Worker a következő percben futtatja a kérést, a workflow kiírja az eredményt.
- **Naplózás:** minden kérés a GitHub felhasználóval együtt az `operator_requests` táblába kerül.

| Művelet | Mikor | Paraméter |
|---|---|---|
| `report` | Áttekintés; csak olvas | – |
| `resend_access_link` | A vevő nem találja a rendelési linket | public ID |
| `retry_invoice` | Végleg sikertelen számla, a hiba javítása után | public ID |
| `retry_invoice_email` | Csak nem-live számlázásnál | public ID |
| `mark_storno_done` | A sztornó elkészült a Számlázz.hu-ban | public ID + sztornó számlaszám |
| `reconcile_refund` | Kézi refund: a Stripe-ban már létező refund rögzítése | public ID |
| `retry_refund` | Kézi refund, és a Stripe-ban igazoltan nincs refund: új refund indul | public ID |
| `requeue_generation` | Kiesés után a sikertelen generálás újraindítása, amíg refund még nem indult | public ID |
| `resolve_anomalies` | A fizetési anomália rendezve | public ID, vagy Stripe objektum ID argumentumként |

A `retry_refund` előbb lekéri a Stripe-tól a payment intent refundjait, és ha talál, megtagadja a futást. Duplikált refund így nem keletkezhet.

## Tipikus helyzetek

### Gemini-kiesés vagy elfogyott kvóta

1. A fizetett rendeléseket a rendszer 1/2/5/10/15/30 perces újrapróbálással kb. 1 órán át tartja várakozásban.
2. Három egymást követő hiba után az új fizetések le vannak tiltva.
3. Ha a kiesés tovább tart, automatikus refund indul. Számla nem készül, így sztornó sem kell.
4. Helyreállás után a még refund előtt álló rendelések a `requeue_generation` művelettel újraindíthatók.

### Hiányzó webhook

A Worker 10 perc után a Stripe-tól visszaolvassa a nyitott checkoutokat, és ugyanazzal a logikával teljesíti őket. Az `Ops watch` jelez, ha a webhook endpoint hiányzik, le van tiltva, vagy események hiányoznak róla.

### A vevő elvesztette a linket

- Fizetéskor visszaigazoló email megy ki a linkkel.
- Új linket önkiszolgálóan a `/rendeles-link` oldalon kérhet.
- Operátorként a `resend_access_link` művelettel küldhető.

## Mentés és visszaállítás

A **Database backup** workflow naponta 03:41 UTC-kor fut:

1. Megszámolja a kritikus táblák sorait.
2. Exportálja a D1 adatbázist.
3. Visszaállítási próbát végez üres SQLite-ba, foreign key ellenőrzéssel.
4. Titkosítja a mentést (AES-256, PBKDF2 600 000 iteráció).
5. 35 napig artifactként tárolja.

A plaintext export a futás végén törlődik.

A `BACKUP_ENCRYPTION_PASSPHRASE` a `production` environment secretje. **Offline másolatot kötelező megőrizni**, mert nélküle a mentés nem fejthető vissza.

Visszafejtés:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in d1-production-<időbélyeg>.sql.gz.enc -pass env:BACKUP_ENCRYPTION_PASSPHRASE | gunzip > backup.sql
```

Visszaállítás, mindig először külön adatbázisba:

```bash
npx wrangler d1 execute <cél-adatbázis> --remote --file backup.sql
```

Egy adott időpontra a D1 Time Travel is használható; minden deploy előtt bookmark artifact készül.
