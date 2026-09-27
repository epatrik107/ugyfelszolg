import { Faq } from "../components/Faq";
import { pricingFaq } from "../content/faq";
import { packages } from "../lib/constants";
import { Link } from "react-router-dom";
import { LegalNotice } from "../components/LegalNotice";
import { PackageCard } from "../components/PackageCard";

export function PricingPage() {
  return (
    <section className="mx-auto max-w-6xl space-y-8 px-4 py-10">
      <div>
        <h1 className="text-3xl font-semibold">Árak és csomagok</h1>
        <p className="mt-3 text-slate-600">
          Válassza azt a csomagot, amelyik legjobban illik az ügyéhez.
          A számlát magánszemély vásárlóknak állítjuk ki.
        </p>
      </div>
      <h2 className="text-2xl font-semibold">Csomagok</h2>
      <div className="grid gap-4 lg:grid-cols-3">
        <PackageCard packageId="basic" />
        <PackageCard packageId="premium" />
        <PackageCard packageId="premium_plus" />
      </div>
      <section className="space-y-3">
        <h2 className="text-2xl font-semibold">Mit tartalmaz a díj?</h2>
        <p className="leading-7 text-slate-600">A díj egy levél elkészítését tartalmazza. A kész szöveget átnézheti, kézzel szerkesztheti, másolhatja és letöltheti. A bankkártyás fizetés a Stripe Checkout felületén történik. A számla elektronikus, a szolgáltató alanyi adómentes.</p>
        <ul className="list-disc space-y-2 pl-5">{Object.values(packages).map((item) => <li key={item.name}>{item.name}: {item.maxRegenerations} AI-módosítás.</li>)}</ul>
      </section>
      <section className="space-y-3">
        <h2 className="text-2xl font-semibold">Melyik csomagot válasszam?</h2>
        <p className="leading-7 text-slate-600">Egyszerűbb panaszhoz vagy reklamációhoz az Alapcsomag ad rövid, hivatalos levelet. A Prémium részletesebb megfogalmazást, alternatív tárgymezőt és zárómondatot, valamint használati javaslatot tartalmaz. A Prémium plusz összetettebb ügyekhez készült, részletesebb levélváltozattal és prémium modellel. A csomag megválasztása nem változtat azon, hogy a szolgáltatás kommunikációs segítség, és nem jogi képviselet.</p>
      </section>
      <section className="space-y-5"><h2 className="text-2xl font-semibold">Gyakori kérdések az árakról</h2><Faq items={pricingFaq} /></section>
      <LegalNotice />
      <Link className="button-primary inline-flex" to="/level-keszites">
        Levél készítése
      </Link>
    </section>
  );
}
