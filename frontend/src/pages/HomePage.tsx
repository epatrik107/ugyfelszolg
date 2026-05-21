import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Link } from "react-router-dom";
import { LegalNotice } from "../components/LegalNotice";

const categories = [
  "Panaszlevél",
  "Reklamáció",
  "Fizetési felszólítás",
  "Szolgáltatói vita",
  "Webáruházas probléma",
  "Céges hivatalos válaszlevél",
  "Bérleti ügyintéző levél",
  "Munkahelyi hivatalos levél",
];

export function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden border-b border-slate-200">
        <div className="absolute inset-0">
          <img
            alt=""
            className="h-full w-full object-cover"
            src="/images/hero-letter-desk.png"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-white via-white/95 to-white/30" />
        </div>
        <div className="relative mx-auto flex min-h-[560px] max-w-6xl items-center px-4 py-12">
          <div className="max-w-xl space-y-6">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-mint-600">
              Ügyfélközpont
            </p>
            <h1 className="text-4xl font-semibold leading-tight md:text-5xl">
              Megírjuk Ön helyett a nehéz leveleket.
            </h1>
            <p className="text-lg leading-8 text-slate-700">
              Írja le röviden a problémáját, fizessen biztonságosan online, mi
              pedig elkészítjük Önnek a hivatalos, udvarias és határozott levelet.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link className="button-primary" to="/level-keszites">
                Levél készítése
                <ArrowRight size={18} />
              </Link>
              <Link className="button-secondary" to="/arak">
                Árak megtekintése
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl space-y-10 px-4 py-14">
        <div className="grid gap-4 md:grid-cols-3">
          {[
            "Írja le a problémáját",
            "Fizessen biztonságosan online",
            "Megkapja az elkészült levelet",
          ].map((step, index) => (
            <div className="rounded-lg border border-slate-200 p-5" key={step}>
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-mint-100 font-semibold text-mint-600">
                {index + 1}
              </div>
              <h2 className="text-lg font-semibold">{step}</h2>
            </div>
          ))}
        </div>

        <div className="space-y-5">
          <h2 className="text-2xl font-semibold">Gyakori levéltípusok</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {categories.map((category) => (
              <div
                className="flex items-center gap-3 rounded-lg border border-slate-200 p-4 text-sm"
                key={category}
              >
                <CheckCircle2 className="shrink-0 text-azure-600" size={18} />
                <span>{category}</span>
              </div>
            ))}
          </div>
        </div>

        <LegalNotice />
      </section>
    </>
  );
}
