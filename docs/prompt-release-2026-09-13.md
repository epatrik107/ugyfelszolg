# Promptok és ténymegőrzés

A generálás és a független AI-ellenőrzés ugyanazokat a forrásadatokat kapja, beleértve az aláíró nevét. A számlázási cím, emailcím, fizetési azonosítók és hozzáférési tokenek nem kerülnek a promptokba. A ténymegőrzési szabály tiltja adatok kitalálását, megkülönbözteti a kérést a megtörtént eseménytől és az idézett harmadik fél állítását a felhasználó tényközlésétől. Hiányzó vagy ellentmondó opcionális adatot a modell nem pótolhat önkényesen.

Módosításkor mindkét modell megkapja az előző mentett levelet és a módosítási kérést. Csak a kért rész módosítandó, a nem érintett részek megőrzésével. A kifejezetten csak lezárásra vonatkozó kéréseknél külön, determinisztikus ellenőrzés is blokkolja a korábbi bekezdések átírását; bizonytalan lezáráshatár esetén nem enged át találgatáson alapuló módosítást. A korábbi levél nem önálló tényforrás. Az ellenőrzés által elutasított első próbálkozás szövege a javító generálásba is bekerül; így az észrevételek konkrét jelöltre vonatkoznak.

Minden felhasználói mező, korábbi levél, jelölt szöveg és ellenőrzési észrevétel escape-elt adathatárba kerül. A rendszerutasítás külön kezeli a legitim levélmódosítást és a szabályfelülírásra, szerepváltásra vagy jóváhagyás kikényszerítésére irányuló utasításokat. A review strukturált JSON-t ad; ellentmondásos jóváhagyás vagy túlméretes hibajegyzék nem enged át levelet. A promptverzió `2026-09-13.1`, a generálás indítási naplójában is szerepel.

A csomagkiegészítéseket a szerveroldali képességek határozzák meg. A kötőjelet igénylő nevek és azonosítók megmaradnak; a tiltás a Markdown-formázásra vonatkozik.

## Ellenőrzési és kiadási terv

A regressziós tesztek ellenőrzik a tényleges szolgáltatói kérések adattartalmát, a módosítási kontextust, az escape-elést, a kizárt személyes/pénzügyi mezőket és a review hibás válaszainak blokkolását. A teljes meglévő tesztcsomag és a 22 böngészőteszt a közös quality workflow-ban fut.

Sandbox deploy után a valódi ütemezett Gemini-generálás és újragenerálás ellenőrzi a rendelésazonosító, összeg, eseménydátum és aláíró megőrzését, valamint a célzott lezárásmódosítást. További hét szintetikus próba a valódi review modell helyes és hibás jelöltre adott döntését vizsgálja, beleértve a levélbe rejtett jóváhagyási utasítást. A sandboxpróba saját rendelését eltakarítja; nem indít fizetést, számlázást vagy emailküldést.

Production deploy csak sikeres CI és sandbox után történik. Utána ellenőrizni kell a pontos Worker-verziót, a health választ, a sémát, valamint a meglévő frontend/API elérhetőségét. Ez a kiadás nem változtat a frontendben, az árakon vagy az adatbázissémán.

Az AI-ellenőrzés forráshűséget vizsgál, nem igazolja az ügy valóságtartalmát. A promptvédelem és a sikeres szintetikus tesztek nem garantálnak hibamentességet minden lehetséges bemenetre. A vásárló átolvasása továbbra is szükséges.

A sandbox ellenőrzésében tapasztalt késleltetett Cloudflare-verzióterjedés miatt a health kapu legfeljebb 24 próbát végez, próbák között 5 másodperccel. Továbbra is megköveteli a pontos commitot, sémát és biztonsági fejléceket; sikertelenségkor megmarad az automatikus visszaállítás.
