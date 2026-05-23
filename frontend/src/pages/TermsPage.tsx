import { LegalNotice } from "../components/LegalNotice";

export function TermsPage() {
  return (
    <section className="mx-auto max-w-4xl space-y-6 px-4 py-10">
      <div>
        <h1 className="text-3xl font-semibold">Általános Szerződési Feltételek</h1>
        <p className="mt-3 text-sm text-slate-500">
          Éles indulás előtt jogásszal ellenőriztetni kell.
        </p>
      </div>
      <LegalNotice />
      <ContentBlock
        title="1. A szolgáltatás leírása"
        text="Az Ügyfélszolgálat online, digitális levélkészítő szolgáltatás. A felhasználó által megadott információk alapján hivatalos hangvételű szöveg készül."
      />
      <ContentBlock
        title="2. Fizetés"
        text="A fizetés bankkártyával, Stripe Checkout felületen történik. A teljesítés csak igazolt sikeres fizetés után indul."
      />
      <ContentBlock
        title="3. Teljesítés"
        text="A szolgáltatás digitális szolgáltatásnak minősül. A levél elkészítése automatikusan történik, a fizetés igazolását követően."
      />
      <ContentBlock
        title="4. Nem jogi tanácsadás"
        text="A szolgáltatás kommunikációs segítséget nyújt, nem helyettesít jogi, pénzügyi vagy egészségügyi tanácsadást."
      />
      <ContentBlock
        title="5. Felelősségkorlátozás"
        text="A felhasználó maga dönt a szöveg felhasználásáról, és saját felelősségére alkalmazza azt."
      />
      <ContentBlock
        title="6. Panaszkezelés"
        text="Panasz esetén a kapcsolat oldalon megadott űrlapon keresztül lehet üzenetet küldeni."
      />
      <ContentBlock
        title="7. Elállási jog"
        text="Placeholder: a digitális szolgáltatásra és az elállási jog gyakorlására vonatkozó végleges tájékoztatást indulás előtt jogi szakértővel kell pontosítani."
      />
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
