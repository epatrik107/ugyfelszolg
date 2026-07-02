import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { DEMO_MODE } from "../lib/config";
import { letterTypes, tones } from "../lib/constants";
import type { BillingDetails, LetterFormValues, PackageId } from "../lib/types";
import { LegalNotice } from "./LegalNotice";
import { PackageCard } from "./PackageCard";
import { TurnstileField } from "./TurnstileField";

export const initialLetterValues: LetterFormValues = {
  name: "",
  email: "",
  letterType: "Panaszlevél",
  recipient: "",
  problemDescription: "",
  desiredResult: "",
  tone: "Udvarias",
  previousMessages: "",
  selectedPackage: "basic",
  checkoutAttemptId: crypto.randomUUID(),
  billing: {
    buyerType: "individual",
    name: "",
    email: "",
    country: "HU",
    postalCode: "",
    city: "",
    addressLine1: "",
  },
  legalAccepted: false,
  turnstileToken: "",
  demoAccessCode: "",
};

type LetterFormProps = {
  busy?: boolean;
  submitLabel: string;
  onSubmit: (values: LetterFormValues) => Promise<void>;
};

export function LetterForm({
  busy = false,
  submitLabel,
  onSubmit,
}: LetterFormProps) {
  const [values, setValues] = useState<LetterFormValues>(initialLetterValues);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error) {
      errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [error]);

  function update<K extends keyof LetterFormValues>(
    key: K,
    value: LetterFormValues[K],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function updateBilling(
    key: "name" | "email" | "postalCode" | "city" | "addressLine1",
    value: string,
  ) {
    setValues((current) => ({
      ...current,
      billing: { ...current.billing, [key]: value },
    }));
  }

  function updateBuyerType(buyerType: BillingDetails["buyerType"]) {
    setValues((current) => {
      const base = {
        name: current.billing.name,
        email: current.billing.email,
        country: "HU" as const,
        postalCode: current.billing.postalCode,
        city: current.billing.city,
        addressLine1: current.billing.addressLine1,
      };
      return {
        ...current,
        billing: buyerType === "business"
          ? {
              ...base,
              buyerType: "business",
              taxNumber: current.billing.buyerType === "business" ? current.billing.taxNumber : "",
            }
          : { ...base, buyerType: "individual" },
      };
    });
  }

  function updateBusinessTaxNumber(value: string) {
    setValues((current) => current.billing.buyerType === "business"
      ? { ...current, billing: { ...current.billing, taxNumber: value } }
      : current);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!values.name.trim() || !values.email.trim() || !values.recipient.trim()) {
      setError("Kérjük, töltse ki a kötelező mezőket.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
      setError("Kérjük, adjon meg érvényes email címet.");
      return;
    }
    if (values.problemDescription.trim().length < 30) {
      setError("A probléma leírása legalább 30 karakter legyen.");
      return;
    }
    if (!values.desiredResult.trim()) {
      setError("Kérjük, írja le, mit szeretne elérni.");
      return;
    }
    if (
      !values.billing.name.trim() ||
      !values.billing.email.trim() ||
      !/^\d{4}$/.test(values.billing.postalCode) ||
      !values.billing.city.trim() ||
      !values.billing.addressLine1.trim()
    ) {
      setError("Kérjük, adja meg a teljes számlázási adatokat.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.billing.email)) {
      setError("Kérjük, adjon meg érvényes számlázási email címet.");
      return;
    }
    if (
      values.billing.buyerType === "business" &&
      !/^\d{8}-\d-\d{2}$/.test(values.billing.taxNumber.trim())
    ) {
      setError("Céges számlázáshoz érvényes magyar adószám szükséges, pl. 12345678-1-42.");
      return;
    }
    if (!values.legalAccepted) {
      setError("A nyilatkozat elfogadása kötelező.");
      return;
    }
    if (!DEMO_MODE && !values.turnstileToken) {
      setError("Kérjük, végezze el a spamvédelmi ellenőrzést.");
      return;
    }
    await onSubmit(values);
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Az Ön neve">
          <input
            className="input"
            maxLength={120}
            placeholder="pl. Kovács János"
            value={values.name}
            onChange={(event) => update("name", event.target.value)}
          />
        </Field>
        <Field label="Email cím (ide küldjük a visszaigazolást)">
          <input
            className="input"
            maxLength={254}
            placeholder="pl. kovacs.janos@email.com"
            type="email"
            value={values.email}
            onChange={(event) => update("email", event.target.value)}
          />
        </Field>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Levél típusa">
          <select
            className="input"
            value={values.letterType}
            onChange={(event) => update("letterType", event.target.value)}
          >
            {letterTypes.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </Field>
        <Field label="Kinek szól a levél? (pl. vállalat neve, hivatal)">
          <input
            className="input"
            maxLength={180}
            placeholder="pl. Telefonszolgáltató Zrt. Ügyfélszolgálat"
            value={values.recipient}
            onChange={(event) => update("recipient", event.target.value)}
          />
        </Field>
      </div>

      <Field label="Mi történt? (Írja le részletesen a problémát)">
        <textarea
          className="input min-h-36"
          maxLength={3000}
          placeholder="pl. 2024. január 5-én megrendeltem egy terméket, de azt hibásan szállították ki, és azóta sem sikerült megoldani a problémát..."
          value={values.problemDescription}
          onChange={(event) => update("problemDescription", event.target.value)}
        />
      </Field>

      <Field label="Mit szeretne elérni? (Mi legyen a megoldás?)">
        <textarea
          className="input min-h-28"
          maxLength={1200}
          placeholder="pl. Kérem a termék kicserélését vagy a vételár visszatérítését."
          value={values.desiredResult}
          onChange={(event) => update("desiredResult", event.target.value)}
        />
      </Field>

      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Hangnem">
          <select
            className="input"
            value={values.tone}
            onChange={(event) => update("tone", event.target.value)}
          >
            {tones.map((tone) => (
              <option key={tone}>{tone}</option>
            ))}
          </select>
        </Field>
        <Field label="Előzmények / korábbi levelezés">
          <textarea
            className="input min-h-28"
            maxLength={3000}
            value={values.previousMessages}
            onChange={(event) => update("previousMessages", event.target.value)}
          />
        </Field>
      </div>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Csomag kiválasztása</h2>
        <p className="text-sm text-slate-600">
          A számla magánszemély vagy magyar adószámmal rendelkező céges vásárló adataiból készül.
        </p>
        <div className="grid gap-4 lg:grid-cols-3">
          {(["basic", "premium", "premium_plus"] as PackageId[]).map((packageId) => (
            <PackageCard
              key={packageId}
              packageId={packageId}
              selected={values.selectedPackage === packageId}
              onSelect={(selectedPackage) => update("selectedPackage", selectedPackage)}
            />
          ))}
        </div>
      </section>

      <section className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-5">
        <div>
          <h2 className="text-lg font-semibold">Számlázási adatok</h2>
          <p className="mt-1 text-sm text-slate-600">
            A számlát a sikeres Stripe fizetés után automatikusan ezekkel az adatokkal állítjuk ki és küldjük ki.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {(["individual", "business"] as const).map((buyerType) => (
            <button
              key={buyerType}
              className={`rounded-md border px-4 py-3 text-left text-sm font-semibold transition ${
                values.billing.buyerType === buyerType
                  ? "border-navy-900 bg-white text-navy-900 shadow-sm"
                  : "border-slate-200 bg-slate-100 text-slate-600 hover:border-slate-300"
              }`}
              type="button"
              onClick={() => updateBuyerType(buyerType)}
            >
              {buyerType === "individual" ? "Magánszemély" : "Céges vásárló"}
            </button>
          ))}
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Számlázási név">
            <input
              className="input"
              maxLength={120}
              placeholder="pl. Kovács János"
              value={values.billing.name}
              onChange={(event) => updateBilling("name", event.target.value)}
            />
          </Field>
          <Field label="Számlázási email">
            <input
              className="input"
              maxLength={254}
              type="email"
              value={values.billing.email}
              onChange={(event) => updateBilling("email", event.target.value)}
            />
          </Field>
        </div>
        {values.billing.buyerType === "business" && (
          <Field label="Magyar adószám">
            <input
              className="input"
              maxLength={13}
              placeholder="12345678-1-42"
              value={values.billing.taxNumber}
              onChange={(event) => updateBusinessTaxNumber(event.target.value)}
            />
          </Field>
        )}
        <div className="grid gap-5 md:grid-cols-3">
          <Field label="Ország">
            <input className="input" disabled value="Magyarország" />
          </Field>
          <Field label="Irányítószám">
            <input
              className="input"
              inputMode="numeric"
              maxLength={4}
              placeholder="1234"
              value={values.billing.postalCode}
              onChange={(event) => updateBilling("postalCode", event.target.value)}
            />
          </Field>
          <Field label="Település">
            <input
              className="input"
              maxLength={100}
              value={values.billing.city}
              onChange={(event) => updateBilling("city", event.target.value)}
            />
          </Field>
        </div>
        <Field label="Közterület neve, jellege és házszám">
          <input
            className="input"
            maxLength={180}
            placeholder="pl. Példa utca 1."
            value={values.billing.addressLine1}
            onChange={(event) => updateBilling("addressLine1", event.target.value)}
          />
        </Field>
      </section>

      <div className="space-y-4">
        <label className="flex cursor-pointer items-start gap-3 text-sm leading-6 text-slate-700">
          <input
            checked={values.legalAccepted}
            className="mt-1 h-5 w-5 shrink-0 accent-navy-900"
            type="checkbox"
            onChange={(event) => update("legalAccepted", event.target.checked)}
          />
          <span>
            Elfogadom, hogy a szolgáltatás nem minősül jogi tanácsadásnak, az
            elkészült szöveget saját felelősségemre használom fel. Elolvastam és
            elfogadom az{" "}
            <Link to="/aszf" className="underline hover:text-slate-900" target="_blank" rel="noopener noreferrer">
              Általános Szerződési Feltételeket
            </Link>{" "}
            és az{" "}
            <Link to="/adatkezeles" className="underline hover:text-slate-900" target="_blank" rel="noopener noreferrer">
              Adatkezelési tájékoztatót
            </Link>
            . Kifejezetten kérem, hogy a digitális szolgáltatás teljesítése a sikeres
            fizetés után azonnal kezdődjön meg, és tudomásul veszem, hogy a teljesítés
            megkezdésével elveszítem a 14 napos elállási jogomat.
          </span>
        </label>
        <LegalNotice />
      </div>

      {DEMO_MODE && (
        <Field label="Demó hozzáférési kód">
          <input
            className="input"
            maxLength={200}
            type="password"
            value={values.demoAccessCode ?? ""}
            onChange={(event) => update("demoAccessCode", event.target.value)}
          />
        </Field>
      )}

      {!DEMO_MODE && (
        <TurnstileField onSuccess={(token) => update("turnstileToken", token)} />
      )}

      {error && (
        <div
          ref={errorRef}
          className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
        >
          {error}
        </div>
      )}

      <button className="button-primary w-full md:w-auto" disabled={busy}>
        {busy && <LoaderCircle className="animate-spin" size={18} />}
        {submitLabel}
      </button>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2 text-base font-medium text-slate-700">
      <span>{label}</span>
      {children}
    </label>
  );
}
