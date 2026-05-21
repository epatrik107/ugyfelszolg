import { Link, useSearchParams } from "react-router-dom";

export function CancelPage() {
  const [searchParams] = useSearchParams();
  const hasOrder = Boolean(searchParams.get("order"));

  return (
    <section className="mx-auto max-w-2xl space-y-6 px-4 py-14">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
        <p className="text-lg font-semibold text-amber-900">A fizetés megszakadt</p>
        <p className="mt-1 text-sm text-amber-700">
          A levél nem készült el, mert a fizetés nem lett véglegesítve.
          <strong> Semmilyen összeg nem lett levonva</strong> a bankszámlájáról.
        </p>
      </div>

      <div className="space-y-3 text-sm text-slate-600">
        <p className="font-medium text-slate-800">Lehetséges okok:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Megszakította a fizetési folyamatot</li>
          <li>A kártya nem rendelkezik elegendő fedezettel</li>
          <li>A kártyakibocsátó megakadályozta a tranzakciót</li>
          <li>Időszakos banki vagy hálózati hiba</li>
        </ul>
      </div>

      <p className="text-sm text-slate-600">
        Megpróbálhatja újra — az adatait nem töröltük, csak a fizetés nem ment át.
        Ha ismételten problémát tapasztal, kérjük, vegye fel velünk a kapcsolatot.
      </p>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Link
          className="button-primary"
          to={hasOrder ? `/level-keszites` : "/level-keszites"}
        >
          Újrapróbálom
        </Link>
        <Link className="button-secondary" to="/kapcsolat">
          Kapcsolatfelvétel
        </Link>
        <Link className="button-secondary" to="/">
          Vissza a főoldalra
        </Link>
      </div>
    </section>
  );
}
