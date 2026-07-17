import { useState } from "react";
import { LegalNotice } from "../components/LegalNotice";
import { TurnstileField } from "../components/TurnstileField";
import { sendContactMessage } from "../lib/api";

export function ContactPage() {
  const [values, setValues] = useState({
    name: "",
    email: "",
    message: "",
    turnstileToken: "",
  });
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [turnstileKey, setTurnstileKey] = useState(0);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      await sendContactMessage(values);
      setStatus("Köszönjük, megkaptuk az üzenetét.");
      setValues({ name: "", email: "", message: "", turnstileToken: "" });
      setTurnstileKey((current) => current + 1);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Ismeretlen hiba.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <div>
        <h1 className="text-3xl font-semibold">Kapcsolat</h1>
        <p className="mt-3 text-slate-600">
          Írjon nekünk, ha kérdése van vagy segítségre van szüksége.
        </p>
      </div>
      <LegalNotice />
      <form className="space-y-5" onSubmit={handleSubmit}>
        <label className="grid gap-2 font-medium text-slate-700">
          <span>Név</span>
          <input
            className="input"
            maxLength={120}
            required
            value={values.name}
            onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))}
          />
        </label>
        <label className="grid gap-2 font-medium text-slate-700">
          <span>Email</span>
          <input
            className="input"
            maxLength={254}
            required
            type="email"
            value={values.email}
            onChange={(event) => setValues((current) => ({ ...current, email: event.target.value }))}
          />
        </label>
        <label className="grid gap-2 font-medium text-slate-700">
          <span>Üzenet</span>
          <textarea
            className="input min-h-40"
            maxLength={3000}
            minLength={10}
            required
            value={values.message}
            onChange={(event) => setValues((current) => ({ ...current, message: event.target.value }))}
          />
        </label>
        <TurnstileField
          key={turnstileKey}
          action="contact"
          onSuccess={(turnstileToken) =>
            setValues((current) => ({ ...current, turnstileToken }))
          }
        />
        {status && (
          <div aria-live="polite" className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
            {status}
          </div>
        )}
        <button className="button-primary" disabled={busy}>
          Üzenet küldése
        </button>
      </form>
    </section>
  );
}
