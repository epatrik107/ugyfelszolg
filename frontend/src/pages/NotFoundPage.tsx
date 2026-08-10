import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <section className="mx-auto max-w-3xl space-y-5 px-4 py-16 text-center">
      <p className="text-sm font-semibold uppercase tracking-widest text-azure-600">404</p>
      <h1 className="text-3xl font-semibold">Az oldal nem található</h1>
      <p className="text-slate-600">
        A hivatkozás hibás vagy az oldal már nem érhető el.
      </p>
      <Link className="button-primary inline-flex" to="/">
        Vissza a főoldalra
      </Link>
    </section>
  );
}
