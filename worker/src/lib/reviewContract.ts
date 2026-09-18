/** Only these non-personal classifications may enter persistent diagnostics. */
export const REVIEW_CODES = [
  "unsupported_fact", "source_conflict", "missing_goal", "wrong_signer",
  "legal_advice", "guaranteed_outcome", "threat", "unsafe_content",
  "format", "revision_scope", "package_content",
] as const;
export const REVIEW_FIELDS = ["subject", "salutation", "body", "request", "closing", "signer", "additions", "whole"] as const;
export type ReviewCode = typeof REVIEW_CODES[number];
export type ReviewField = typeof REVIEW_FIELDS[number];
export type ReviewFinding = { code: ReviewCode; field: ReviewField; instruction: string };

export const LETTER_CONTENT_POLICY = `KÖZÖS ELFOGADÁSI SZABÁLYOK
A forrásban nem megadott összeg, fizetési határidő, szerződéses kikötés és jogszabály nem kötelező eleme a levélnek. Ezek hiánya nem hiba: ne követelj és ne találj ki ilyen adatot, javításkor sem. A „kérem, rendezze az elmaradást” konkrét kérés pontos összeg vagy dátum nélkül is. A mai dátumból ne számolj fizetési határidőt.
A felhasználó beszámolója közölhető a saját nézőpontjából, jogi minősítés és külső igazolás nélkül. A zárcsere, kizárás, tartozás vagy más vitatott esemény megemlítése önmagában nem jogi tanács, fenyegetés vagy tiltott tartalom. A szereplőket ne cseréld fel: ha a bérlő zárta ki a levélírót, ne írd azt, hogy a levélíró zárta ki a bérlőt.
A határozott fizetési kérés, a szerződés lezárásának és a lakás visszaadásának kérése megengedett. A kért eredményt szándékként vagy egyeztetési kérésként közöld; ne állítsd már létrejött megállapodásnak vagy automatikus jogi kötelezettségnek. Például: „Kérem az elmaradt bérleti díj rendezését, továbbá a szerződés lezárásáról és a lakás átadásáról való egyeztetést.”
A felhasználó által jelzett későbbi jogi lépés szándéka semleges megfogalmazással közölhető; ez nem az olvasónak adott eljárási tanács. Ne követelj erősebb fenyegetést. Ne írj eljárási útmutatót, jogi minősítést, biztos eredményt, kényszerítést vagy jogkövetkezményt. A fenyegető kifejezések udvarias kérésre cserélése nem a felhasználói cél elhagyása.
Az értékelés lényegi hibákat keressen: forrással ellentétes vagy kitalált tény, hiányzó érdemi kérés/aláíró, tiltott tanács/fenyegetés, hibás forma vagy kért módosítás megsértése. Stílusbeli ízlés, hiányzó opcionális adat és ugyanazt jelentő természetes átfogalmazás nem elutasítási ok. Nem kell minden háttérkörülményt szó szerint felsorolni, ha a levél célja és tényállítása nem változik.`;
