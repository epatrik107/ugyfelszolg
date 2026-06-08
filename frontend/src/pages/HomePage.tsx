import { ArrowRight, CheckCircle2, Star } from "lucide-react";
import { Link } from "react-router-dom";
import { LegalNotice } from "../components/LegalNotice";

const categories = [
  "Panaszlevél",
  "Reklamáció",
  "Fizetési felszólítás",
  "Szolgáltatói vita",
  "Webáruházas probléma",
  "Hivatalos válaszlevél",
  "Bérleti ügyintéző levél",
  "Munkahelyi hivatalos levél",
];

const testimonials = [
  {
    name: "Kovács Csaba",
    comment:
      "Nagyon jól működik a program! Pár perc alatt kaptam egy profi panaszlevelet, amit azonnal el is tudtam küldeni a szolgáltatónak.",
  },
  {
    name: "Nagy Erika",
    comment:
      "Egyszerűen zseniális! Nem kellett nekem fogalmaznom, az AI mindent megírt helyettem. A közműszolgáltató azonnal reagált is a levélre.",
  },
  {
    name: "Tóth Márton",
    comment:
      "Kicsit szkeptikus voltam, de tényleg egy korrekt, hivatalos levelet generált. Sok időt és idegeskedést spórolt meg nekem.",
  },
  {
    name: "Szabó Judit",
    comment:
      "A webáruházas reklamációmat gyönyörűen megírták. Már másnap visszahívtak az üzletből, hogy intézik a visszatérítést. Szuper szolgáltatás!",
  },
  {
    name: "Horváth Péter",
    comment:
      "Fizetési felszólítást generáltattam, profi munka volt. A levél határozott, de udvarias stílusban készült el. Bátran ajánlom bárkinek.",
  },
];

export function HomePage() {
  const heroImageSrc = `${import.meta.env.BASE_URL}images/hero-letter-desk.png`;

  return (
    <>
      <section className="relative overflow-hidden border-b border-slate-200">
        <div className="absolute inset-0">
          <img
            alt=""
            className="h-full w-full object-cover"
            src={heroImageSrc}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-white from-50% via-white/95 to-white/30" />
        </div>
        <div className="relative mx-auto flex min-h-[560px] max-w-6xl items-center px-4 py-12">
          <div className="max-w-xl space-y-6">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-mint-600">
              Ügyfélszolgálat
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

        <div className="space-y-5">
          <h2 className="text-2xl font-semibold">Vélemények</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {testimonials.slice(0, 3).map((t) => (
              <div
                className="rounded-lg border border-slate-200 bg-white p-6"
                key={t.name}
              >
                <div className="mb-3 flex gap-1">
                  {[...Array(5)].map((_, i) => (
                    <Star
                      key={i}
                      size={16}
                      className="fill-mint-500 text-mint-500"
                    />
                  ))}
                </div>
                <p className="mb-4 text-sm leading-6 text-slate-700">
                  &ldquo;{t.comment}&rdquo;
                </p>
                <p className="text-sm font-semibold text-navy-900">
                  — {t.name}
                </p>
              </div>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {testimonials.slice(3).map((t) => (
              <div
                className="rounded-lg border border-slate-200 bg-white p-6"
                key={t.name}
              >
                <div className="mb-3 flex gap-1">
                  {[...Array(5)].map((_, i) => (
                    <Star
                      key={i}
                      size={16}
                      className="fill-mint-500 text-mint-500"
                    />
                  ))}
                </div>
                <p className="mb-4 text-sm leading-6 text-slate-700">
                  &ldquo;{t.comment}&rdquo;
                </p>
                <p className="text-sm font-semibold text-navy-900">
                  — {t.name}
                </p>
              </div>
            ))}
          </div>
        </div>

        <LegalNotice />
      </section>
    </>
  );
}
