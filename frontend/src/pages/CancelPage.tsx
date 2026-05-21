import { Link } from "react-router-dom";

export function CancelPage() {
  return (
    <section className="mx-auto max-w-3xl space-y-5 px-4 py-14">
      <h1 className="text-3xl font-semibold">A fizetés nem sikerült</h1>
      <p className="text-slate-600">
        A levél nem készült el, mert a fizetés nem lett véglegesítve.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link className="button-primary" to="/level-keszites">
          Újrapróbálom
        </Link>
        <Link className="button-secondary" to="/">
          Vissza a főoldalra
        </Link>
      </div>
    </section>
  );
}
