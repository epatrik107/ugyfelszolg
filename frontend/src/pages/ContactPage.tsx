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

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      await sendContactMessage(values);
      setStatus("Köszönjük, megkaptuk az üzenetét.");
      setValues({ name: "", email: "", message: "", turnstileToken: "" });
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
        <input
          className="input"
          placeholder="Név"
          value={values.name}
          onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))}
        />
        <input
          className="input"
          placeholder="Email"
          type="email"
          value={values.email}
          onChange={(event) => setValues((current) => ({ ...current, email: event.target.value }))}
        />
        <textarea
          className="input min-h-40"
          placeholder="Üzenet"
          value={values.message}
          onChange={(event) => setValues((current) => ({ ...current, message: event.target.value }))}
        />
        <TurnstileField
          onSuccess={(turnstileToken) =>
            setValues((current) => ({ ...current, turnstileToken }))
          }
        />
        {status && (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
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
