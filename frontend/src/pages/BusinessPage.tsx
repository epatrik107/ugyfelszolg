import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { LetterForm } from "../components/LetterForm";
import { TurnstileField } from "../components/TurnstileField";
import {
  createBusinessOrder,
  createBusinessPortalSession,
  exchangeBusinessMagicLink,
  getBusinessSession,
  requestBusinessAccessLink,
} from "../lib/api";
import type { BusinessSession, LetterFormValues } from "../lib/types";

export function BusinessPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [sessionToken, setSessionToken] = useState(
    sessionStorage.getItem("business-session-token"),
  );
  const [businessSession, setBusinessSession] = useState<BusinessSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [accessEmail, setAccessEmail] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");

  useEffect(() => {
    const magic = searchParams.get("magic");
    if (!magic) {
      return;
    }
    const magicToken = magic;
    async function exchange() {
      try {
        const payload = await exchangeBusinessMagicLink(magicToken);
        sessionStorage.setItem("business-session-token", payload.sessionToken);
        setSessionToken(payload.sessionToken);
        searchParams.delete("magic");
        setSearchParams(searchParams, { replace: true });
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Ismeretlen hiba.");
      }
    }
    void exchange();
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!sessionToken) {
      return;
    }
    const activeSessionToken = sessionToken;
    async function load() {
      try {
        setBusinessSession(await getBusinessSession(activeSessionToken));
      } catch {
        sessionStorage.removeItem("business-session-token");
        setSessionToken(null);
      }
    }
    void load();
  }, [sessionToken]);

  async function sendAccessLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      await requestBusinessAccessLink({ email: accessEmail, turnstileToken });
      setStatus("Ha van aktív céges előfizetés, elküldtük a hozzáférési linket.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Ismeretlen hiba.");
    } finally {
      setBusy(false);
    }
  }

  async function createOrder(values: LetterFormValues) {
    if (!sessionToken) {
      return;
    }
    setBusy(true);
    try {
      const payload = await createBusinessOrder(
        {
          name: values.name,
          email: values.email,
          letterType: values.letterType,
          recipient: values.recipient,
          problemDescription: values.problemDescription,
          desiredResult: values.desiredResult,
          tone: values.tone,
          previousMessages: values.previousMessages,
          legalAccepted: values.legalAccepted,
        },
        sessionToken,
      );
      sessionStorage.setItem(
        `result-token:${payload.publicId}`,
        payload.resultToken,
      );
      navigate(`/sikeres-fizetes?order=${payload.publicId}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Ismeretlen hiba.");
    } finally {
      setBusy(false);
    }
  }

  async function openPortal() {
    if (!sessionToken) {
      return;
    }
    const payload = await createBusinessPortalSession(sessionToken);
    window.location.href = payload.url;
  }

  if (!sessionToken || !businessSession) {
    return (
      <section className="mx-auto max-w-xl space-y-6 px-4 py-10">
        <div>
          <h1 className="text-3xl font-semibold">Céges ügyfelek</h1>
          <p className="mt-3 text-slate-600">
            Kérjen biztonságos hozzáférési linket az előfizetéséhez.
          </p>
        </div>
        <form className="space-y-4" onSubmit={sendAccessLink}>
          <input
            className="input"
            placeholder="Email cím"
            type="email"
            value={accessEmail}
            onChange={(event) => setAccessEmail(event.target.value)}
          />
          <TurnstileField onSuccess={setTurnstileToken} />
          {status && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              {status}
            </div>
          )}
          <button className="button-primary" disabled={busy}>
            {busy && <LoaderCircle className="animate-spin" size={18} />}
            Hozzáférési link küldése
          </button>
        </form>
      </section>
    );
  }

  return (
    <section className="mx-auto grid max-w-6xl gap-8 px-4 py-10 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="h-fit rounded-lg border border-slate-200 bg-slate-50 p-5">
        <h1 className="text-2xl font-semibold">Céges portál</h1>
        <dl className="mt-5 space-y-4 text-sm">
          <Info label="Email" value={businessSession.email} />
          <Info label="Állapot" value={businessSession.status} />
          <Info label="Havi keret" value={`${businessSession.quota} levél`} />
          <Info label="Felhasznált" value={`${businessSession.used} levél`} />
          <Info label="Fennmaradó" value={`${businessSession.remaining} levél`} />
        </dl>
        <button className="button-secondary mt-5 w-full" onClick={openPortal}>
          Előfizetés kezelése
        </button>
      </aside>

      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-semibold">Új céges levél</h2>
          <p className="mt-3 text-slate-600">
            Az aktív előfizetés részeként új levelet készíthet.
          </p>
        </div>
        {status && (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
            {status}
          </div>
        )}
        <LetterForm
          mode="business"
          busy={busy}
          submitLabel="Levél elkészítése"
          onSubmit={createOrder}
        />
      </div>
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}
