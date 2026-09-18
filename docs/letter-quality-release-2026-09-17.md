# Levélminőség javítása – megvalósítási és kiadási terv

## Igazolt probléma és cél

Az éles hibánál mindkét levélváltozatot elutasította az AI-review; a kifogások tartalma nem maradt meg. A régi kód anonim, valós Gemini-próbájában a review nem megadott fizetési határidőt követelt, a javítás kitalált egy dátumot, majd az ellenőrzés ezt is elutasította. Emellett a bemenetben szereplő zárcserét egyszer megkövetelte, később önmagában tiltott tartalomnak tekintette. Ez reprodukált szabályellentmondás; az eredeti vásárlás pontos kifogásai utólag nem rekonstruálhatók.

Cél: forráshű, udvarias, határozott levelek; az ellenőrzés a lényegi hibákat fogja meg, ne követeljen új tényt vagy jogi fenyegetést. Biztonsági és tényellenőrzési kapu nélkül levél továbbra sem adható ki.

## Megvalósítás

1. Közös, egyértelmű generálási és review-szabályok: hiányzó összeg/határidő kihagyható; a felhasználó által leírt esemény közölhető jogi minősítés nélkül; a rendezési igény kérés marad. A reviewer nem kérhet a szabályokkal ellentétes javítást.
2. A már helyes végső aláíró elé a hiányzó udvarias záróformulát determinisztikusan beillesztjük, még az AI-review előtt. Hibás vagy hiányzó aláírást nem fedünk el. Strukturált, szerveroldalon validált kifogások (kód, hely, javítás), célzott második kör. A javításban a forrásadatok és a tartalmi korlátok elsőbbséget élveznek a review szabad szövegével szemben. A kétváltozatos költségkeretet megtartjuk.
3. Közös generálás–review–javítás függvény az éles út és a szintetikus értékelés számára. A sikeres review után publikálunk; végleges elutasításnál az eddigi tartós refund működik.
4. Additív diagnosztikai tábla: változatonként modell/promptverzió, eredmény és engedélyezett kifogáskód/hely. Nincs teljes levél, nyers kifogásszöveg, ügyféladat vagy token a diagnosztikában. Lejárt rendeléshez tartozó adatok törlése; idegen/lejárt futás nem írhat diagnózist.
5. A gyorsan visszatérített generálási hibák is megjelennek az operátori riportban; egy rendelés külön, csak olvasásra vizsgálható.
6. Pontosabb hibaüzenet az ügyfélnek, külön tartalmi és technikai okkal.

## Teszt és kiadás

- Valós modellpróba a javítás előtt és után, kizárólag kitalált személyekkel: megfelelő felszólítás, hiányzó opcionális adatok, kitalált határidő, szerepcsere, fenyegetés, promptinjekció, célzott módosítás; többszöri teljes generálás.
- Egységtesztek a sémára, a javító prompt adatkezelésére és a hibakódokra; valódi SQLite-integráció a diagnosztika, retention, stale-run védelem, sikeres javítás és elutasítás/refund működésére.
- Teljes typecheck, teszt, build, migrációs ellenőrzés és CI-böngészőteszt.
- Elkülönített sandbox deploy, valódi ütemezett generálás és módosítás. Ezt követően main merge és production deploy a meglévő GitHub Actions folyamatával.
- Production előtt és után a production Gemini-beállításokkal szintetikus minőségi próba; a deploy utáni health az új revisiont és sémát ellenőrizze. A production-próba nem hoz létre vásárlást, számlát vagy emailt; a valós ütemezett teljesítést sandboxban teszteljük.
- A production egészség- vagy minőségi ellenőrzésének hibája a korábbi Worker-verzióra visszaállítást váltson ki. A migráció visszafelé kompatibilis.

## Eredmények

- Helyi typecheck és build sikeres; 402/402 backend/script teszt, 32/32 asztali/mobil böngészőteszt, 15/15 migráció sikeres.
- Az anonim eredeti hiba a régi prompttal két körben elutasítást eredményezett. A javított prompttal a célzott javítás után elfogadott, határidőt nem kitaláló levél készült.
- A teljes modellteszt első futásában minden rögzített review-eset teljesült, majd a szolgáltató 429-et adott; a tesztfuttatás 12 másodperces ütemezést kapott.
- A végleges modell-, sandbox- és production-eredmények a kiadás után kerülnek ide.

A Gemini 3 hívások a szolgáltató alapértelmezett temperature értékét használják. A [Google Gemini 3 útmutatója](https://ai.google.dev/gemini-api/docs/generate-content/gemini-3) az alacsony értékek helyett ezt ajánlja a lehetséges utasításkövetési/ismétlődési problémák elkerülésére. A stabil elfogadást a közös szabályok, a strukturált kimenet és a regressziós minőségi tesztek biztosítják.
