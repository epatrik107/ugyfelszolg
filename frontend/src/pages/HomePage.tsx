import { Faq } from "../components/Faq";
import { homeFaq } from "../content/faq";
import { packages } from "../lib/constants";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Link } from "react-router-dom";
import { LegalNotice } from "../components/LegalNotice";
import { generatedLetterExamples } from "../lib/marketing";

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

export function HomePage() {
  const imageBase = `${import.meta.env.BASE_URL}images/hero-letter-desk`;
  const srcSet = (format: string) => [640, 1024, 1600].map((width) => `${imageBase}-${width}.${format} ${width}w`).join(", ");

  return (
    <>
      <section className="relative overflow-hidden border-b border-slate-200">
        <div className="absolute inset-0">
          <picture>
            <source type="image/avif" srcSet={srcSet("avif")} sizes="100vw" />
            <source type="image/webp" srcSet={srcSet("webp")} sizes="100vw" />
            <img alt="" className="h-full w-full object-cover" src={`${imageBase}-1024.webp`} width={1691} height={930} fetchPriority="high" decoding="async" />
          </picture>
          <div className="absolute inset-0 bg-gradient-to-r from-white from-50% via-white/95 to-white/30" />
        </div>
        <div className="relative mx-auto flex min-h-[560px] max-w-6xl items-center px-4 py-12">
          <div className="max-w-xl space-y-6">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-mint-600">
              Levélsegéd
            </p>
            <h1 className="text-4xl font-semibold leading-tight md:text-5xl">
              Hivatalos levél írása online – megírjuk Ön helyett
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
        <h2 className="text-2xl font-semibold">Hogyan működik?</h2>
        <ol className="grid gap-4 md:grid-cols-3">
          {[
            "Írja le a problémáját",
            "Fizessen biztonságosan online",
            "Megkapja az elkészült levelet",
          ].map((step, index) => (
            <li className="rounded-lg border border-slate-200 p-5" key={step}>
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-mint-100 font-semibold text-mint-600">
                {index + 1}
              </div>
              <h3 className="text-lg font-semibold">{step}</h3>
              <p className="mt-3 text-sm leading-6 text-slate-600">{[
                "Adja meg a címzettet, a fontos időpontokat és azt, milyen megoldást szeretne. Nem kell kész hivatalos szöveget írnia: elegendő, ha saját szavaival, időrendben elmondja a történteket. A levél a megadott információkból készül, ezért a pontos adatok fontosabbak, mint a választékos fogalmazás.",
                "Válasszon csomagot, majd ellenőrizze a levél adatait és a számlázási adatokat az összegzésben. Az összegzés megnyitása még nem indít fizetést. A bankkártyás fizetéshez a Stripe Checkout felületére lép tovább. A feltüntetett árak a fizetendő végösszegek.",
                "Sikeres fizetés után a rendszer elkészíti a levelet. Olvassa át a szöveget, különösen a neveket, összegeket, dátumokat és a kért megoldást. A levelet kézzel is szerkesztheti, másolhatja vagy letöltheti. Az elkészült szöveg felhasználásáról és elküldéséről Ön dönt.",
              ][index]}</p>
            </li>
          ))}
        </ol>

        <div className="space-y-5">
          <h2 className="text-2xl font-semibold">Milyen ügyekben segítünk?</h2>
          <p className="leading-7 text-slate-600">Ha nehéz elkezdeni egy hivatalos levelet, válassza ki az ügyéhez legközelebb álló helyzetet. A levélíró szolgáltatás panasz, reklamáció, felszólítás vagy válaszlevél megfogalmazásában segít. Összetett ügyben is az Ön által megadott tényekből indulunk ki; hiányzó adatot ne találjon ki, inkább jelezze, ha valamiben bizonytalan.</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {categories.map((category) => (
              <Link
                to={`/level-keszites?eset=${category === "Webáruházas probléma" ? "delivery" : category === "Reklamáció" ? "invoice" : category === "Szolgáltatói vita" ? "service" : "other"}`}
                className="flex items-center gap-3 rounded-lg border border-slate-200 p-4 text-sm hover:border-azure-600"
                key={category}
              >
                <CheckCircle2 className="shrink-0 text-azure-600" size={18} />
                <span>{category}</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="space-y-5">
          <div>
            <h2 className="text-2xl font-semibold">Példák az elkészült levelekből</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              A rendszer hivatalos, udvarias és határozott szöveget készít. Az
              alábbi minták rövidített példák, nem minősülnek jogi tanácsadásnak.
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {generatedLetterExamples.map((example) => (
              <article
                className="rounded-lg border border-slate-200 bg-slate-50 p-5"
                key={example.title}
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-azure-700">
                  {example.title}
                </p>
                <h3 className="mt-2 text-base font-semibold">{example.subject}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  {example.excerpt}
                </p>
              </article>
            ))}
          </div>
        </div>

        <section className="space-y-5">
          <h2 className="text-2xl font-semibold">Árak röviden</h2>
          <div className="grid gap-4 md:grid-cols-3">{Object.values(packages).map((item) => <div key={item.name} className="rounded-lg border border-slate-200 p-5"><h3 className="font-semibold">{item.name}</h3><p className="mt-2 text-xl font-semibold">{item.price}</p><p className="mt-2 text-sm text-slate-600">Egy levél és {item.maxRegenerations} AI-módosítás.</p></div>)}</div>
          <p className="leading-7 text-slate-600">A csomagok a megfogalmazás részletességében és a kiegészítésekben különböznek. Egyszerűbb ügyhöz rövid levél is megfelelő lehet; több előzménynél fontos lehet a részletesebb összefoglalás. Fizetés előtt minden csomagot összehasonlíthat, és ellenőrizheti a kiválasztott szolgáltatás díját.</p>
          <Link to="/arak" className="inline-block underline">Csomagok és árak összehasonlítása</Link>
        </section>
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">Amit tudnia kell az AI-val készült levélről</h2>
          <p className="leading-7 text-slate-600">A hivatalos hangvétel önmagában nem bizonyítja, hogy egy állítás helyes vagy egy kérés teljesíthető. A mesterséges intelligencia hibázhat, ezért a kész levél minden adatát ellenőrizze. Ha a megfogalmazás nem tükrözi pontosan a szándékát, javítsa. Különösen fontos ez összegek, határidők és korábbi egyeztetések leírásakor.</p>
          <p className="leading-7 text-slate-600">A szolgáltatás célja, hogy érthetően és rendezett formában fogalmazza meg az ügyét. Nem ígérjük, hogy a címzett elfogadja a kérését, és nem járunk el Ön helyett. A bizonyítékokat, mellékleteket és a megfelelő címzettet Ön választja ki. Ha az ügy jogi értelmezést vagy szakmai döntést igényel, kérjen személyre szabott segítséget megfelelő szakembertől.</p>
          <LegalNotice />
        </section>
        <section className="space-y-5"><h2 className="text-2xl font-semibold">Gyakori kérdések</h2><Faq items={homeFaq} /><Link className="inline-block underline" to="/rendeles-link">Rendelési link újraküldése</Link></section>
        <section className="space-y-4 rounded-xl bg-slate-50 p-6">
          <h2 className="text-2xl font-semibold">Kezdje a történet rövid leírásával</h2>
          <p className="leading-7 text-slate-600">Készítse elő az ügy legfontosabb adatait: kinek ír, mi történt, mikor jelezte a problémát, és milyen választ vagy intézkedést vár. A háromlépéses űrlap végigvezeti ezeken a kérdéseken. Az összegzésben még egyszer átnézheti az adatokat, mielőtt a fizetéshez továbblép.</p>
          <Link className="button-primary inline-flex" to="/level-keszites">Levél készítése online</Link>
        </section>
      </section>
    </>
  );
}
