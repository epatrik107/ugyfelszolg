# Felhasználói felület fejlesztése – 2026. szeptember 12.

## Megvalósítás

1. A levélkészítő három lépésre oszlik: ügy leírása, kívánt megoldás, majd csomag és számlázás. A visszalépés és az összegzésből történő szerkesztés megtartja az adatokat. A számlázási név és email kitöltését a már megadott adatok segítik.
2. Négy ügykártya ad célzott kérdéseket és mintákat. Az ügytípus váltása nem írja felül a felhasználó szövegét. Mobilon a hosszabb mintalevél-panel összecsukható.
3. A várakozási képernyő kizárólag a szervertől kapott állapotot mutatja. A backend nem ad külön review-fázist, ezért a generálás és minőségellenőrzés közös lépésként szerepel. Az eltelt idő nem változtatja készre a generálást. Hosszabb várakozáskor segítség és rendelésazonosító jelenik meg.
4. A kész levél papírszerű, tördelhető nézetet, kézi szerkesztőt, másolást és TXT-letöltést kap. Mindkét művelet a megjelenített, szerkesztett változatot használja. A korábbi változatok választhatók, a kézi szerkesztés visszavonható. Mobilon a műveletsor a képernyő alján is elérhető.
5. A „Legyen rövidebb”, „Legyen határozottabb” és „Egyszerűbb nyelvezet” gomb közvetlen AI-módosítást kér. Előre jelzi az egy módosításnyi keretfelhasználást. Folyamatban lévő módosítás alatt az ismételt indítás tiltott; a korábbi levél tovább olvasható.
6. A mezőhibák közvetlenül az érintett mező mellett jelennek meg, hozzákapcsolt akadálymentes címkékkel és fókuszkezeléssel. Fizetési hiba után a kitöltés és az újrapróbálás azonosítója megmarad, friss spamvédelmi ellenőrzés szükséges. Hibásan betöltődő ellenőrzés újratölthető a teljes oldal frissítése nélkül.

## Határok és kompatibilitás

A kézi szerkesztés az oldal memóriájában marad. Az oldal ezt jelzi, és bezárás előtt letöltést javasol. Az emailküldés és az AI-módosítás továbbra is a szerveren mentett változatokon dolgozik; a felület ezt külön megnevezi. A kézi szerkesztés nem fogyaszt AI-keretet. Ebben a kiadásban TXT-export készült; PDF/DOCX-export nem része a jóváhagyott hat UI-feladatnak.

A backend szerződései, fizetési árai és csomagjogosultságai változatlanok. A kiadás frontend-deployt igényel, adatbázis-migrációt nem. A meglévő emaildiagnosztikai javításokra épül.

## Ellenőrzés és kiadás

A meglévő 337 Worker-teszt mellett 22 új Playwright-próba fut, azonos forgatókönyvekkel asztali és mobilos Chromiumon. A próbák a production frontend buildet használják; a fizetést, API-válaszokat és Turnstile-t kizárólag a tesztfuttató helyettesíti. Nincs productionbe fordított tesztmegkerülés.

A próbák ellenőrzik a mezővalidációt, adatmegőrzést, összegzést, idempotens fizetési újrapróbálást, átirányítást, szerkesztett letöltés tényleges tartalmát, másolási hibát, változatválasztást, újragenerálást, keretkimerülést, valós várakozási állapotot és keskeny képernyős tördelést. A képi ellenőrzéshez űrlap-, összegzés- és eredményoldal-képek készülnek.

A közös quality workflow ezeket a böngészős próbákat is futtatja a korábbi typecheck, teszt, build, dependency audit és migrációs ellenőrzések mellett. Csak sikeres PR-ellenőrzés után következhet main merge és frontend-kiadás. A kiadás után a pontos commit, HTTPS, biztonsági fejlécek és SPA-útvonal mellett az éles űrlap navigációját is ellenőrizni kell. Éles vásárlást a felületi próbák nem indítanak.
