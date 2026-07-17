import { Link } from "react-router-dom";
import { LegalNotice } from "../components/LegalNotice";
import legalVersions from "../config/legalVersions.json";

const TERMS_VERSION = legalVersions.terms.version;
const TERMS_DATE = legalVersions.terms.effectiveDate;

export function TermsPage() {
  return (
    <section className="mx-auto max-w-4xl space-y-6 px-4 py-10">
      <div>
        <h1 className="text-3xl font-semibold">Általános Szerződési Feltételek</h1>
        <p className="mt-2 text-sm text-slate-500">
          Verzió: {TERMS_VERSION} · Hatályos: {TERMS_DATE}
        </p>
      </div>
      <LegalNotice />
      <ContentBlock
        title="1. Szolgáltató adatai"
        text="Szolgáltató neve: Engelbrecht Zoltán egyéni vállalkozó. Vállalkozás formája: egyéni vállalkozó. Székhelye: 2500 Esztergom, Bánomi út 4. Adószáma: 91250960-1-31. Közösségi adószáma: HU91250960. EV nyilvántartási száma: 60722263. E-mail: Zoltán Engelbrecht <ugyfelszolgalat2026@gmail.com>. Weboldal: ügyfelszolgalat.hu."
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
        text="A szolgáltatás magánszemély és magyar adószámmal rendelkező céges vásárló számára vehető igénybe. A felhasználónak ki kell töltenie az adatlap és a számlázási adatok minden kötelező mezőjét; céges vásárló esetén a cégnév és magyar adószám megadása kötelező. A felhasználónak el kell fogadnia az ÁSZF-et és az Adatkezelési tájékoztatót, majd sikeres bankkártyás fizetést kell végrehajtania. A fizetési folyamat a Stripe Checkout felületen zajlik – a bankkártya adatokat a Stripe dolgozza fel, azok nem kerülnek a Szolgáltató rendszereibe. A feltüntetett árak bruttó árak. Az ár megrendelés közben nem változtatható; a Szolgáltató kizárólag az általa meghatározott díjat fogadja el."
      />
      <ContentBlock
        title="5. Teljesítés és digitális tartalom"
        text="A szolgáltatás digitális tartalomnak minősül. A teljesítés a sikeres fizetés igazolása után automatikusan megkezdődik. A kész levél az eredményoldalon érhető el, és e-mailben is elküldhető. A Szolgáltató törekszik az elkészítési idő minimalizálására, de technikai okok miatt az legfeljebb néhány percet vehet igénybe. A prémium csomagoktól függően a levél újra elkészíthető."
      />
      <ContentBlock
        title="6. Elállási jog"
        text="Az Európai Parlament és a Tanács 2011/83/EU irányelve, valamint a 45/2014. (II.26.) Korm. rendelet alapján a fogyasztó 14 napos elállási joggal rendelkezik digitális tartalom megvásárlásakor. FONTOS: a fogyasztó az elállási jogát elveszíti, ha a digitális tartalom előállítása a fogyasztó kifejezett, előzetes beleegyezésével megkezdődött, és a fogyasztó tudomásul vette, hogy ezzel elveszíti elállási jogát. A megrendelési folyamat során a felhasználó kifejezetten beleegyezik az azonnali teljesítésbe és tudomásul veszi az elállási jog megszűnését."
      />
      <ComplaintHandlingBlock />
      <ContentBlock
        title="8. Számlázás"
        text="A sikeres fizetés után a Számlázz.hu automatikusan, kizárólag a megadott számlázási adatokkal állítja ki és küldi ki az elektronikus számlát. Sikertelen, megszakított vagy lejárt fizetésre nem készül számla."
      />
      <ContentBlock
        title="9. Felelősségkorlátozás"
        text="A Szolgáltató nem vállal felelősséget harmadik felek (Stripe, Számlázz.hu, Cloudflare, Google, Resend) rendszer-leállásaiból fakadó késedelemért vagy kiesésért. A Szolgáltató felelőssége a megfizetett szolgáltatási díj összegére korlátozódik."
      />
      <ContentBlock
        title="10. Irányadó jog"
        text="Az ÁSZF-re a magyar jog az irányadó. A felhasználó és a Szolgáltató vitájuk rendezésére elsőként tárgyalásos megoldást keresnek. Fogyasztói jogvita esetén a fogyasztó bírósághoz vagy a hatáskörrel rendelkező békéltető testülethez fordulhat."
      />
      <ContentBlock
        title="11. Módosítás"
        text="A Szolgáltató fenntartja a jogot az ÁSZF egyoldalú módosítására. A módosítás hatályba lépéséről értesítést tesz közzé a weboldalon. Az értesítés után a szolgáltatás igénybevétele a módosított ÁSZF elfogadásának minősül."
      />
      <p className="text-xs text-slate-400 pt-4">
        ÁSZF verzió: {TERMS_VERSION} · Hatályos: {TERMS_DATE} ·{" "}
        <Link to="/adatkezeles" className="underline hover:text-slate-600">Adatkezelési tájékoztató</Link>
      </p>
    </section>
  );
}

function ComplaintHandlingBlock() {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">7. Panaszkezelés és jogorvoslat</h2>
      <p className="leading-7 text-slate-700">
        A jogsértő tartalomra érkező panaszokat a Szolgáltató 3 munkanapon belül kivizsgálja, és
        annak eredményéről a panaszost írásban értesíti. A panasztételi lehetőségek megegyeznek az
        1. pontban meghatározott szolgáltatói elérhetőségekkel.
      </p>
      <p className="leading-7 text-slate-700">
        A Szolgáltató panasz közlésére vagy benyújtására szóban (telefonon), illetve írásban
        (postai úton vagy elektronikus levélben) biztosít lehetőséget. A telefonon közölt szóbeli
        panaszt minden munkanapon előre egyeztetett időpontban, 9-17 óra között, elektronikus
        eléréssel fogadja; üzemzavar esetén megfelelő más elérhetőséget biztosít. Az írásbeli
        panaszokat folyamatosan fogadja.
      </p>
      <p className="leading-7 text-slate-700">
        A szolgáltatással kapcsolatos fogyasztói panasszal a Felhasználó az illetékes
        fogyasztóvédelmi hatóság, a hatáskörrel rendelkező békéltető testület, elektronikus
        hirdetésekkel kapcsolatos ügyben pedig a Nemzeti Média- és Hírközlési Hatóság eljárását
        kezdeményezheti. Az NMHH központi ügyfélszolgálata: 1133 Budapest, Visegrádi u. 106.;
        levelezési cím: 1376 Budapest, Pf. 997.; e-mail: info@nmhh.hu. Az NMHH székhelye: 1015
        Budapest, Ostrom utca 23-25.; levelezési cím: 1525 Budapest, Pf. 75.
      </p>
      <p className="leading-7 text-slate-700">
        A panaszkezelésre egyebekben a fogyasztóvédelemről szóló 1997. évi CLV. törvény
        rendelkezései irányadók.
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
