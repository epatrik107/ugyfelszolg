import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import { DEMO_MODE } from "../lib/config";
import { letterTypes, tones } from "../lib/constants";
import type { LetterFormValues, PackageId } from "../lib/types";
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
  legalAccepted: false,
  turnstileToken: "",
  demoAccessCode: "",
};

type LetterFormProps = {
  mode?: "checkout" | "business";
  busy?: boolean;
  submitLabel: string;
  onSubmit: (values: LetterFormValues) => Promise<void>;
};

export function LetterForm({
  mode = "checkout",
  busy = false,
  submitLabel,
  onSubmit,
}: LetterFormProps) {
  const [values, setValues] = useState<LetterFormValues>(initialLetterValues);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof LetterFormValues>(
    key: K,
    value: LetterFormValues[K],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
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
    if (!values.legalAccepted) {
      setError("A nyilatkozat elfogadása kötelező.");
      return;
    }
    if (mode === "checkout" && !DEMO_MODE && !values.turnstileToken) {
      setError("Kérjük, végezze el a spamvédelmi ellenőrzést.");
      return;
    }
    await onSubmit(values);
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Név">
          <input
            className="input"
            maxLength={120}
            value={values.name}
            onChange={(event) => update("name", event.target.value)}
          />
        </Field>
        <Field label="Email cím">
          <input
            className="input"
            maxLength={254}
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
        <Field label="Kinek szól a levél?">
          <input
            className="input"
            maxLength={180}
            value={values.recipient}
            onChange={(event) => update("recipient", event.target.value)}
          />
        </Field>
      </div>

      <Field label="Mi történt?">
        <textarea
          className="input min-h-36"
          maxLength={3000}
          value={values.problemDescription}
          onChange={(event) => update("problemDescription", event.target.value)}
        />
      </Field>

      <Field label="Mit szeretne elérni?">
        <textarea
          className="input min-h-28"
          maxLength={1200}
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

      {mode === "checkout" && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Csomag kiválasztása</h2>
          <div className="grid gap-4 lg:grid-cols-3">
            {(["basic", "premium", "business"] as PackageId[]).map((packageId) => (
              <PackageCard
                key={packageId}
                packageId={packageId}
                selected={values.selectedPackage === packageId}
                onSelect={(selectedPackage) => update("selectedPackage", selectedPackage)}
              />
            ))}
          </div>
        </section>
      )}

      <div className="space-y-4">
        <label className="flex items-start gap-3 text-sm leading-6 text-slate-700">
          <input
            checked={values.legalAccepted}
            className="mt-1 h-4 w-4"
            type="checkbox"
            onChange={(event) => update("legalAccepted", event.target.checked)}
          />
          <span>
            Elfogadom, hogy a szolgáltatás nem minősül jogi tanácsadásnak, az
            elkészült szöveget saját felelősségemre használom fel.
          </span>
        </label>
        <LegalNotice />
      </div>

      {mode === "checkout" && DEMO_MODE && (
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

      {mode === "checkout" && !DEMO_MODE && (
        <TurnstileField onSuccess={(token) => update("turnstileToken", token)} />
      )}

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
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
    <label className="grid gap-2 text-sm font-medium text-slate-700">
      <span>{label}</span>
      {children}
    </label>
  );
}
