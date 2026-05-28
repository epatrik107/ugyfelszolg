import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LetterForm } from "../components/LetterForm";
import { LegalNotice } from "../components/LegalNotice";
import { createCheckoutSession } from "../lib/api";
import { DEMO_MODE } from "../lib/config";
import { packages } from "../lib/constants";
import type { LetterFormValues } from "../lib/types";

export function LetterCreationPage() {
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<LetterFormValues | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const serverErrorRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (serverError) {
      serverErrorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [serverError]);

  async function handleSubmit(values: LetterFormValues) {
    setSummary(values);
  }

  async function continueToPayment() {
    if (!summary) {
      return;
    }
    setBusy(true);
    setServerError(null);
    try {
      const response = await createCheckoutSession(summary);
      window.location.href = response.checkoutUrl;
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "Ismeretlen hiba.");
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-semibold">Levélkészítés</h1>
          <p className="mt-3 text-slate-600">
            Adja meg a szükséges részleteket, mi pedig elkészítjük az Önnek
            szóló hivatalos levelet.
          </p>
        </div>
        <LegalNotice />
        <LetterForm
          busy={busy}
          submitLabel="Összegzés megnyitása"
          onSubmit={handleSubmit}
        />
      </div>

      <aside className="h-fit rounded-lg border border-slate-200 bg-slate-50 p-5">
        <h2 className="text-lg font-semibold">Fizetés előtti összegzés</h2>
        {DEMO_MODE && (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800">
            Demó üzemmód aktív: a szerver csak helyes hozzáférési kóddal indít
            fizetés nélküli próba levélírást.
          </div>
        )}
        {summary ? (
          <div className="mt-5 space-y-4 text-sm">
            <SummaryRow label="Név" value={summary.name} />
            <SummaryRow label="Email" value={summary.email} />
            <SummaryRow label="Levél típusa" value={summary.letterType} />
            <SummaryRow label="Csomag" value={packages[summary.selectedPackage].name} />
            <SummaryRow
              label="Fizetendő"
              value={`${packages[summary.selectedPackage].price}${
                packages[summary.selectedPackage].recurring ?? ""
              }`}
            />
            <LegalNotice />
            {serverError && (
              <div
                ref={serverErrorRef}
                className="rounded-md border border-rose-200 bg-rose-50 p-3 text-rose-700"
              >
                {serverError}
              </div>
            )}
            <button className="button-primary w-full" disabled={busy} onClick={continueToPayment}>
              {DEMO_MODE ? "Levélírás kipróbálása" : "Biztonságos fizetés"}
            </button>
            <button className="button-secondary w-full" onClick={() => navigate("/arak")}>
              Árak újra megtekintése
            </button>
          </div>
        ) : (
          <p className="mt-4 text-sm leading-6 text-slate-600">
            Az űrlap kitöltése után itt ellenőrizheti még egyszer a rendelését.
          </p>
        )}
      </aside>
    </section>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-3">
      <span className="text-slate-500">{label}</span>
      <strong className="text-right">{value}</strong>
    </div>
  );
}
