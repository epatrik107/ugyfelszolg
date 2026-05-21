import { Link } from "react-router-dom";
import { LegalNotice } from "../components/LegalNotice";
import { PackageCard } from "../components/PackageCard";

export function PricingPage() {
  return (
    <section className="mx-auto max-w-6xl space-y-8 px-4 py-10">
      <div>
        <h1 className="text-3xl font-semibold">Árak</h1>
        <p className="mt-3 text-slate-600">
          Válassza azt a csomagot, amelyik legjobban illik az ügyéhez.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <PackageCard packageId="basic" />
        <PackageCard packageId="premium" />
        <PackageCard packageId="business" />
      </div>
      <LegalNotice />
      <Link className="button-primary inline-flex" to="/level-keszites">
        Levél készítése
      </Link>
    </section>
  );
}
