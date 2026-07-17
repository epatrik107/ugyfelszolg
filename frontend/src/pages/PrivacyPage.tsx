import { Link } from "react-router-dom";
import { LegalNotice } from "../components/LegalNotice";
import legalVersions from "../config/legalVersions.json";

const PRIVACY_VERSION = legalVersions.privacy.version;
const PRIVACY_DATE = legalVersions.privacy.effectiveDate;

export function PrivacyPage() {
  return (
    <section className="mx-auto max-w-4xl space-y-6 px-4 py-10">
      <div>
        <h1 className="text-3xl font-semibold">Adatkezelési tájékoztató</h1>
        <p className="mt-2 text-sm text-slate-500">
          Verzió: {PRIVACY_VERSION} · Hatályos: {PRIVACY_DATE}
        </p>
      </div>
      <LegalNotice />
      <ContentBlock
        title="1. Adatkezelő"
        text="Adatkezelő neve: Engelbrecht Zoltán egyéni vállalkozó. Vállalkozás formája: egyéni vállalkozó. Székhelye: 2500 Esztergom, Bánomi út 4. Adószáma: 91250960-1-31. Közösségi adószáma: HU91250960. EV nyilvántartási száma: 60722263. E-mail: Zoltán Engelbrecht <ugyfelszolgalat2026@gmail.com>. Weboldal: ügyfelszolgalat.hu."
      />
      <ContentBlock
        title="2. Kezelt adatok"
        text="Név, e-mail cím, számlázási név vagy cégnév, számlázási e-mail, ország, irányítószám, település és cím, céges vásárló esetén magyar adószám, a levél elkészítéséhez megadott szöveges adatok (panasz leírása, kívánt eredmény, korábbi üzenetek), csomagválasztás, fizetési azonosítók (Stripe session ID, fizetési szándék ID – kártyaadatok nem kerülnek hozzánk), számlaszám és számlázási állapot, megrendelési állapot, rendelési eredmény token hash-e (nem visszafejthető), technikai naplók (IP-cím, időbélyeg, személyes adatot nem tartalmazó hibakódok)."
      />
      <ContentBlock
        title="3. Az adatkezelés céljai és jogalapjai"
        text="(a) Szerződés teljesítése (GDPR 6. cikk (1) b): megrendelt levél előállítása és kézbesítése. (b) Jogos érdek (GDPR 6. cikk (1) f): visszaélések megelőzése, rate limiting, rendszerbiztonság. (c) Jogi kötelezettség (GDPR 6. cikk (1) c): számlázási és adómegőrzési kötelezettségek teljesítése."
      />
      <ContentBlock
        title="4. Adattovábbítás és adatfeldolgozók"
        text="Stripe Inc. (USA) – fizetési tranzakció feldolgozása; KBOSS.hu Kft. / Számlázz.hu (Magyarország) – elektronikus számla kiállítása és kézbesítése; Cloudflare Inc. (USA) – backend futtatás, D1 adatbázis, KV tároló, Turnstile spamvédelem; Google LLC – Gemini API, a levélgeneráláshoz szükséges szöveges adatok kerülnek átadásra; Resend Inc. – egyéb tranzakciós e-mail kézbesítés. Az EGT-n kívüli adatfeldolgozók az EU–USA adatvédelmi keretrendszer vagy Standard Contractual Clauses alapján kezelik az adatokat."
      />
      <ContentBlock
        title="5. Adatmegőrzési idők"
        text="A levél elkészítéséhez megadott szöveges adatok, előzmények és elkészült levelek: 90 nap a rendelés létrehozásától számítva, ezt követően a rendszer redaktálja vagy törli őket. Számlázási adatok és számlák: a hatályos számviteli jogszabályok szerint (jelenleg 8 év). Kapcsolatfelvételi üzenetek: 2 év. Technikai naplók: 30 nap."
      />
      <ContentBlock
        title="6. Az érintett jogai"
        text="Hozzáférési jog: kérheti a kezelt adatairól szóló tájékoztatást. Helyesbítés: kérheti a pontatlan adatok javítását. Törlés ('elfeledtetés'): kérheti adatai törlését, amennyiben az adatkezelés jogalapja megszűnt és jogszabályi megőrzési kötelezettség nem terhel. Adathordozhatóság: kérheti adatait géppel olvasható formátumban. Tiltakozás: tiltakozhat a jogos érdeken alapuló adatkezelés ellen. Felügyeleti hatósághoz fordulás: panasz esetén a Nemzeti Adatvédelmi és Információszabadság Hatósághoz (naih.hu) lehet fordulni."
      />
      <ContentBlock
        title="7. E-mailben küldött személyes adatok"
        text="Ha a felhasználó kéri, hogy a kész levelet e-mailben küldjük el, a levél szövegét (amely személyes adatokat tartalmazhat) e-mailben eljuttatjuk a megadott e-mail-címre. Az e-mail kézbesítést a Resend Inc. végzi. Az e-mail titkosítva kerül kézbesítésre (TLS), de az e-mail jellegéből adódóan tartalma harmadik felek számára hozzáférhetővé válhat. Ezt a kockázatot a felhasználó tudomásul veszi az e-mailes küldés kérésekor."
      />
      <ContentBlock
        title="8. Adatbiztonsági intézkedések"
        text="Az adatokat titkosított kapcsolaton (HTTPS/TLS) keresztül kezeljük. A hozzáférési tokeneket egyirányú hash formájában tároljuk. A rendszer Cloudflare infrastruktúrán fut, amely iparági biztonsági szabványokat alkalmaz."
      />
      <ContentBlock
        title="9. Kapcsolat és törlési kérelem"
        text="Adatkezelési kérdés, törlési kérelem vagy panasz esetén a kapcsolat oldalon található űrlapon vagy a Zoltán Engelbrecht <ugyfelszolgalat2026@gmail.com> e-mail-címen lehet üzenetet küldeni. A kérelmekre 30 napon belül válaszolunk."
      />
      <p className="text-xs text-slate-400 pt-4">
        Adatkezelési tájékoztató verzió: {PRIVACY_VERSION} · Hatályos: {PRIVACY_DATE} ·{" "}
        <Link to="/aszf" className="underline hover:text-slate-600">ÁSZF</Link>
      </p>
    </section>
  );
}

function ContentBlock({ title, text }: { title: string; text: string }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="leading-7 text-slate-700">{text}</p>
    </section>
  );
}
