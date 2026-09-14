import { useState } from "react";
import { Link } from "react-router-dom";
import { TurnstileField } from "../components/TurnstileField";
import { requestOrderAccessLink } from "../lib/api";

export function AccessLinkPage() {
  const [email, setEmail] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileKey, setTurnstileKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await requestOrderAccessLink({ email, turnstileToken });
      setDone(response.message);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Ismeretlen hiba.");
    } finally {
      // Turnstile tokens are single-use.
      setTurnstileToken("");
      setTurnstileKey((key) => key + 1);
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <div>
        <h1 className="text-3xl font-semibold">Rendelési link újraküldése</h1>
        <p className="mt-3 text-slate-600">
          Ha bezárta az oldalt vagy nem találja a visszaigazoló emailt, adja meg a rendeléskor megadott email-címét.
          A fizetett rendeléseihez tartozó linkeket erre a címre küldjük el.
        </p>
      </div>
      {done ? (
        <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-emerald-900">
          <p>{done}</p>
          <p className="mt-2 text-sm">Nézze meg a Spam/Levélszemét mappát is. Ha nem érkezik meg, <Link className="underline" to="/kapcsolat">írjon nekünk</Link>.</p>
        </div>
      ) : (
        <form className="space-y-5" onSubmit={handleSubmit}>
          <label className="grid gap-2 font-medium text-slate-700">
            <span>Email-cím</span>
            <input
              className="input"
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <TurnstileField key={turnstileKey} action="access_link" onSuccess={setTurnstileToken} />
          {error && <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
          <button className="button-primary" disabled={busy || !turnstileToken}>
            {busy ? "Küldés folyamatban…" : "Linkek küldése"}
          </button>
        </form>
      )}
    </section>
  );
}
