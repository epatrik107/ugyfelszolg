import { Link } from "react-router-dom";
import { LegalNotice } from "../components/LegalNotice";

const TERMS_VERSION = "1.0";
const TERMS_DATE = "2025-01-15";

export function TermsPage() {
  return (
    <section className="mx-auto max-w-4xl space-y-6 px-4 py-10">
      <div>
        <h1 className="text-3xl font-semibold">Általános Szerződési Feltételek</h1>
        <p className="mt-2 text-sm text-slate-500">
          Verzió: {TERMS_VERSION} · Hatályos: {TERMS_DATE}
        </p>
        <p className="mt-1 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          Éles indulás előtt jogásszal ellenőriztetni kell.
        </p>
      </div>
      <LegalNotice />
      <ContentBlock
        title="1. Szolgáltató adatai"
        text="Szolgáltató neve: [KITÖLTENDŐ – Vállalkozás neve]. Székhelye: [KITÖLTENDŐ – Cím]. Adószáma: [KITÖLTENDŐ]. E-mail: [KITÖLTENDŐ]. Weboldal: ügyfelszolgalat.hu"
      />
      <ContentBlock
        title="2. A szolgáltatás leírása"
        text="Az ügyfelszolgalat.hu online, automatizált digitális levélkészítő szolgáltatás. A felhasználó által megadott adatok (panasz leírása, kívánt eredmény, hangnem) alapján mesterséges intelligencia segítségével hivatalos hangvételű szöveg (panaszlevél, reklamáció, egyéb hivatalos levél) kerül előállításra. A szolgáltatás kommunikációs segítséget nyújt – nem helyettesít jogi, pénzügyi vagy egészségügyi szakmai tanácsadást."
      />
      <ContentBlock
        title="3. Nem jogi tanácsadás"
        text="A szolgáltatás keretében előállított szöveg kommunikációs célú segítség. Az elkészített levél nem minősül jogi tanácsnak, jogi képviseletnek, sem egyéb szakmai tanácsadásnak. A felhasználó saját belátása és felelőssége szerint dönt a szöveg felhasználásáról. A Szolgáltató nem vállal felelősséget a szöveg felhasználásának következményeiért."
      />
      <ContentBlock
        title="4. Megrendelés és fizetés"
        text="A szolgáltatás igénybevételéhez a felhasználónak ki kell töltenie az adatlap minden kötelező mezőjét, el kell fogadnia az ÁSZF-et és az Adatkezelési tájékoztatót, majd sikeres bankkártyás fizetést kell végrehajtania. A fizetési folyamat a Stripe Checkout felületen zajlik – a bankkártya adatokat a Stripe dolgozza fel, azok nem kerülnek a Szolgáltató rendszereibe. A feltüntetett árak bruttó fogyasztói árak. Az ár megrendelés közben nem változtatható; a Szolgáltató kizárólag az általa meghatározott díjat fogadja el."
      />
      <ContentBlock
        title="5. Teljesítés és digitális tartalom"
        text="A szolgáltatás digitális tartalomnak minősül. A teljesítés a sikeres fizetés igazolása után automatikusan megkezdődik. A kész levél az eredményoldalon érhető el, és e-mailben is elküldhető. A Szolgáltató törekszik az elkészítési idő minimalizálására, de technikai okok miatt az legfeljebb néhány percet vehet igénybe. A prémium csomagoktól függően a levél újra elkészíthető."
      />
      <ContentBlock
        title="6. Elállási jog"
        text="Az Európai Parlament és a Tanács 2011/83/EU irányelve, valamint a 45/2014. (II.26.) Korm. rendelet alapján a fogyasztó 14 napos elállási joggal rendelkezik digitális tartalom megvásárlásakor. FONTOS: a fogyasztó az elállási jogát elveszíti, ha a digitális tartalom előállítása a fogyasztó kifejezett, előzetes beleegyezésével megkezdődött, és a fogyasztó tudomásul vette, hogy ezzel elveszíti elállási jogát. A megrendelési folyamat során a felhasználó kifejezetten beleegyezik az azonnali teljesítésbe és tudomásul veszi az elállási jog megszűnését."
      />
      <ContentBlock
        title="7. Panaszkezelés és számlázás"
        text="Minőségi kifogás, számlaigény vagy egyéb panasz esetén a kapcsolat oldalon megadott elérhetőségeken veheti fel a felhasználó a kapcsolatot. A Szolgáltató 30 napon belül válaszol. Számla igény esetén a rendelési adatokat (rendelés azonosítója, e-mail cím) kell megadni. A számla elektronikus formában kerül kiállításra."
      />
      <ContentBlock
        title="8. Felelősségkorlátozás"
        text="A Szolgáltató nem vállal felelősséget harmadik felek (Stripe, Cloudflare, Google, Resend) rendszer-leállásaiból fakadó késedelemért vagy kiesésért. A Szolgáltató felelőssége a megfizetett szolgáltatási díj összegére korlátozódik."
      />
      <ContentBlock
        title="9. Irányadó jog"
        text="Az ÁSZF-re a magyar jog az irányadó. A felhasználó és a Szolgáltató vitájuk rendezésére elsőként tárgyalásos megoldást keresnek. Fogyasztói jogvita esetén a fogyasztó bírósághoz vagy a hatáskörrel rendelkező békéltető testülethez fordulhat."
      />
      <ContentBlock
        title="10. Módosítás"
        text="A Szolgáltató fenntartja a jogot az ÁSZF egyoldalú módosítására. A módosítás hatályba lépéséről értesítést tesz közzé a weboldalon. Az értesítés után a szolgáltatás igénybevétele a módosított ÁSZF elfogadásának minősül."
      />
      <p className="text-xs text-slate-400 pt-4">
        ÁSZF verzió: {TERMS_VERSION} · Hatályos: {TERMS_DATE} ·{" "}
        <Link to="/adatkezeles" className="underline hover:text-slate-600">Adatkezelési tájékoztató</Link>
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
