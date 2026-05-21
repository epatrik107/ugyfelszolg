import { LegalNotice } from "../components/LegalNotice";

export function PrivacyPage() {
  return (
    <section className="mx-auto max-w-4xl space-y-6 px-4 py-10">
      <div>
        <h1 className="text-3xl font-semibold">Adatkezelési tájékoztató</h1>
        <p className="mt-3 text-sm text-slate-500">
          Éles indulás előtt adatvédelmi szakértővel vagy jogásszal ellenőriztetni kell.
        </p>
      </div>
      <LegalNotice />
      <ContentBlock
        title="Kezelt adatok"
        text="Név, email cím, a levél elkészítéséhez megadott adatok, kapcsolatfelvételi üzenetek, fizetési és technikai tranzakciós azonosítók."
      />
      <ContentBlock
        title="Adatkezelési cél"
        text="A megrendelt digitális szolgáltatás teljesítése, ügyfélkapcsolat, visszaélések megelőzése és jogszabályi kötelezettségek teljesítése."
      />
      <ContentBlock
        title="Stripe használata"
        text="A bankkártyás fizetések feldolgozását a Stripe végzi; a kártyaadatok nem kerülnek az Ügyfélközpont szervereire."
      />
      <ContentBlock
        title="OpenAI API használata"
        text="A levélgeneráláshoz az OpenAI API kerül igénybevételre a megadott szöveges adatok alapján."
      />
      <ContentBlock
        title="Cloudflare használata"
        text="A backend, adatbázis, spamvédelem és bizonyos technikai naplók Cloudflare szolgáltatásokon futnak."
      />
      <ContentBlock
        title="Adattörlés kérése"
        text="Az érintett kérheti adatai törlését a kapcsolat oldalon keresztül."
      />
      <ContentBlock
        title="Kapcsolat"
        text="Adatkezelési kérdés esetén a kapcsolat oldalon található űrlapon lehet üzenetet küldeni."
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
