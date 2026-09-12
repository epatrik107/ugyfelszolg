import { CheckCircle2, KeyRound, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LetterForm } from "../components/LetterForm";
import { LegalNotice } from "../components/LegalNotice";
import { TurnstileField } from "../components/TurnstileField";
import { ApiRequestError, createCheckoutSession } from "../lib/api";
import { DEMO_MODE } from "../lib/config";
import { packages } from "../lib/constants";
import { generatedLetterExamples } from "../lib/marketing";
import type { LetterFormValues } from "../lib/types";

export function LetterCreationPage() {
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<LetterFormValues | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverErrorCode, setServerErrorCode] = useState<string | null>(null);
  const serverErrorRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const formContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (serverError) {
      serverErrorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [serverError]);

  useEffect(() => {
    if (summary) {
      summaryRef.current?.focus();
    }
  }, [summary]);

  async function handleSubmit(values: LetterFormValues) {
    setServerError(null);
    setServerErrorCode(null);
    setSummary({ ...values, turnstileToken: "", checkoutAttemptId: crypto.randomUUID() });
  }

  async function continueToPayment() {
    if (!summary) {
      return;
    }
    setBusy(true);
    setServerError(null);
    setServerErrorCode(null);
    try {
      const response = await createCheckoutSession(summary);
      window.location.href = response.checkoutUrl;
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "Ismeretlen hiba.");
      setServerErrorCode(error instanceof ApiRequestError ? error.code ?? null : null);
      if (!DEMO_MODE) {
        // Turnstile tokens are single-use. Keep the form and summary data, but
        // require a fresh challenge before a safe idempotent retry.
        setSummary((current) => current ? { ...current, turnstileToken: "" } : current);
      }
      setBusy(false);
    }
  }

  function updateDemoAccessCode(demoAccessCode: string) {
    setSummary((current) => current ? { ...current, demoAccessCode } : current);
  }

  function updateTurnstileToken(turnstileToken: string) {
    setSummary((current) => current ? { ...current, turnstileToken } : current);
  }

  return (
    <section className="mx-auto max-w-6xl space-y-8 px-4 py-10">
      <div ref={formContainerRef} hidden={!!summary} className={summary ? "hidden" : "grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]"}>
        <div className="space-y-6">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-azure-600">
              3–5 perc kitöltés
            </p>
            <h1 className="mt-2 text-3xl font-semibold">Levélkészítés</h1>
            <p className="mt-3 text-slate-600">
              Adja meg a szükséges részleteket, mi pedig elkészítjük az Önnek
              szóló hivatalos levelet. Három rövid lépés, a végén ellenőrizhető összegzéssel.
            </p>
          </div>
          <p className="text-sm text-slate-500">AI-val készített levél, amelyet elküldés előtt átnézhet és szerkeszthet. Nem minősül jogi tanácsadásnak.</p>
          <LetterForm
            busy={busy}
            submitLabel="Összegzés megnyitása"
            onSubmit={handleSubmit}
          />
        </div>

        <aside className="h-fit lg:sticky lg:top-24">
          <div className="hidden lg:block"><ExamplesPanel /></div>
          <details className="rounded-xl border border-slate-200 p-4 lg:hidden">
            <summary className="cursor-pointer font-medium">Mintalevelek megtekintése</summary>
            <div className="mt-4"><ExamplesPanel /></div>
          </details>
        </aside>
      </div>

      {summary && <PaymentSummary
        busy={busy}
        onChangePackage={() => { setSummary(null); setServerError(null); setServerErrorCode(null); window.requestAnimationFrame(() => formContainerRef.current?.querySelector<HTMLElement>("h2[tabindex]")?.focus()); }}
        onContinue={continueToPayment}
        onDemoAccessCodeChange={updateDemoAccessCode}
        onTurnstileTokenChange={updateTurnstileToken}
        serverError={serverError}
        serverErrorCode={serverErrorCode}
        serverErrorRef={serverErrorRef}
        summary={summary}
        summaryRef={summaryRef}
      />}
    </section>
  );
}

function ExamplesPanel() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-azure-100 text-azure-700">
          <Sparkles size={18} />
        </span>
        <div>
          <h2 className="text-lg font-semibold">Milyen levelet kap?</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Rövid minták az elkészült hivatalos hangvételű levelekből.
          </p>
        </div>
      </div>
      <div className="mt-4 space-y-3">
        {generatedLetterExamples.map((example) => (
          <article
            className="rounded-xl border border-slate-200 bg-slate-50 p-4"
            key={example.title}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-azure-700">
              {example.title}
            </p>
            <p className="mt-2 text-sm font-semibold text-slate-900">
              {example.subject}
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {example.excerpt}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function PaymentSummary({
  busy,
  onChangePackage,
  onContinue,
  onDemoAccessCodeChange,
  onTurnstileTokenChange,
  serverError,
  serverErrorCode,
  serverErrorRef,
  summary,
  summaryRef,
}: {
  busy: boolean;
  onChangePackage: () => void;
  onContinue: () => void;
  onDemoAccessCodeChange: (demoAccessCode: string) => void;
  onTurnstileTokenChange: (turnstileToken: string) => void;
  serverError: string | null;
  serverErrorCode: string | null;
  serverErrorRef: React.RefObject<HTMLDivElement | null>;
  summary: LetterFormValues | null;
  summaryRef: React.RefObject<HTMLElement | null>;
}) {
  const shouldShowDemoCodeField = DEMO_MODE || serverErrorCode === "DEMO_ONLY";
  const primaryActionLabel = shouldShowDemoCodeField
    ? "Demó levélírás indítása"
    : "Biztonságos fizetés";

  return (
    <section
      ref={summaryRef}
      tabIndex={-1}
      aria-label="Fizetés előtti összegzés"
      className="outline-none scroll-mt-24 rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm md:p-6"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-azure-600">
            Utolsó lépés
          </p>
          <h2 className="mt-2 text-2xl font-semibold">Fizetés előtti összegzés</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Itt még nem történik fizetés. Ellenőrizze az adatokat, és csak akkor
            lépjen tovább a Stripe biztonságos fizetési oldalára, ha minden rendben van.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-mint-700">
          <CheckCircle2 size={17} />
          Számla automatikus kiküldéssel
        </div>
      </div>

      {DEMO_MODE && (
        <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800">
          Demó üzemmód aktív: a szerver csak helyes hozzáférési kóddal indít
          fizetés nélküli próba levélírást.
        </div>
      )}

      <div className="mt-4"><LegalNotice /></div>
      {summary ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="grid gap-3 text-sm md:grid-cols-2">
            <SummaryRow label="Az Ön adatai" value={`${summary.name}\n${summary.email}`} />

            <SummaryRow
              label="Számlázási adatok"
              value={`${summary.billing.name}\n${summary.billing.postalCode} ${summary.billing.city}, ${summary.billing.addressLine1}\n${summary.billing.email}`}
            />
            <SummaryRow label="Levél típusa" value={summary.letterType} />
            <SummaryRow label="Címzett" value={summary.recipient} />
            <SummaryRow label="Mi történt?" value={summary.problemDescription} />
            <SummaryRow label="Kért megoldás" value={summary.desiredResult} />
            <SummaryRow label="Hangnem" value={summary.tone} />
            <SummaryRow
              label="Csomag"
              value={packages[summary.selectedPackage].name}
            />
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-500">Fizetendő összeg</p>
            <p className="mt-1 text-3xl font-semibold text-navy-900">
              {packages[summary.selectedPackage].price}
              {packages[summary.selectedPackage].recurring && (
                <span className="text-sm font-medium text-slate-500">
                  {" "}
                  {packages[summary.selectedPackage].recurring}
                </span>
              )}
            </p>
            <p className="mt-3 text-xs leading-5 text-slate-500">
              Egyszeri fizetés, előfizetés nélkül. Egy levél és {packages[summary.selectedPackage].maxRegenerations} AI-módosítás; másolás, letöltés és kézi szerkesztés. A számlát emailben küldjük.
            </p>
            {serverError && (
              <div
                ref={serverErrorRef}
                role="alert"
                className="mt-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
              >
                {serverError}
                <p className="mt-2">Az adatai megmaradtak. Az alábbi ellenőrzés után újrapróbálhatja.</p>
              </div>
            )}
            {!DEMO_MODE && !summary.turnstileToken && (
              <div className="mt-4 space-y-2">
                <p className="text-sm text-slate-600">
                  A fizetéshez végezze el a biztonsági ellenőrzést. Hiba után új ellenőrzés szükséges.
                </p>
                <TurnstileField action="checkout" onSuccess={onTurnstileTokenChange} />
              </div>
            )}
            {shouldShowDemoCodeField && (
              <label className="mt-4 grid gap-2 text-sm font-medium text-slate-700">
                <span className="flex items-center gap-2">
                  <KeyRound size={16} />
                  Demó hozzáférési kód
                </span>
                <input
                  autoComplete="off"
                  className="input"
                  maxLength={200}
                  placeholder="Írja be a teszteléshez kapott kódot"
                  type="password"
                  value={summary.demoAccessCode ?? ""}
                  onChange={(event) => onDemoAccessCodeChange(event.target.value)}
                />
                <span className="text-xs leading-5 text-slate-500">
                  Csak demó / teszt üzemmódban szükséges. Valós fizetésnél nem kell kitölteni.
                </span>
              </label>
            )}
            <div className="mt-4 grid gap-3">
              <button
                className="button-primary w-full"
                disabled={busy || (!DEMO_MODE && !summary.turnstileToken)}
                onClick={onContinue}
              >
                {busy ? "Átirányítás folyamatban…" : `${primaryActionLabel}${shouldShowDemoCodeField ? "" : ` · ${packages[summary.selectedPackage].price}`}`}
              </button>
              <button className="button-secondary w-full" disabled={busy} onClick={onChangePackage}>
                Adatok és csomag módosítása
              </button>
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-5 rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm leading-6 text-slate-600">
          Az űrlap kitöltése és az „Összegzés megnyitása” gomb megnyomása után
          itt, a lap alján jelenik meg a végső ellenőrzés és a fizetési gomb.
        </p>
      )}
    </section>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <p className="mt-1 whitespace-pre-wrap break-words text-slate-900">{value}</p>
    </div>
  );
}
