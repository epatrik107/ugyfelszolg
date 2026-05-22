import { Copy, Download, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { LegalNotice } from "../components/LegalNotice";
import { getOrderResult } from "../lib/api";
import type { OrderResult } from "../lib/types";

export function SuccessPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const publicId = searchParams.get("order") ?? "";
  const queryToken = searchParams.get("token");
  const storageKey = useMemo(() => `result-token:${publicId}`, [publicId]);
  const [token, setToken] = useState<string | null>(
    queryToken || sessionStorage.getItem(storageKey),
  );
  const [result, setResult] = useState<OrderResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const intervalRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (queryToken) {
      sessionStorage.setItem(storageKey, queryToken);
      setToken(queryToken);
      searchParams.delete("token");
      setSearchParams(searchParams, { replace: true });
    }
  }, [queryToken, searchParams, setSearchParams, storageKey]);

  const MAX_POLL_ATTEMPTS = 75; // ~5 minutes at 4s interval
  const pollCountRef = useRef(0);

  useEffect(() => {
    if (!publicId || !token) {
      return;
    }
    const activePublicId = publicId;
    const activeToken = token;
    pollCountRef.current = 0;

    let active = true;
    async function poll() {
      pollCountRef.current += 1;
      try {
        const payload = await getOrderResult(activePublicId, activeToken);
        if (!active) return;
        setResult(payload);
        setError(null);
        const isTerminal =
          payload.aiStatus === "completed" ||
          payload.aiStatus === "failed" ||
          payload.aiStatus === "failed_review" ||
          payload.paymentStatus === "refunded";
        if (isTerminal || pollCountRef.current >= MAX_POLL_ATTEMPTS) {
          window.clearInterval(intervalRef.current);
          if (!isTerminal && pollCountRef.current >= MAX_POLL_ATTEMPTS) {
            setError(
              "A generálás a vártnál hosszabb ideig tart. Kérjük, töltse újra az oldalt néhány perc múlva, vagy vegye fel velünk a kapcsolatot.",
            );
          }
        }
      } catch (pollError) {
        if (active) {
          setError(pollError instanceof Error ? pollError.message : "Ismeretlen hiba.");
        }
      }
    }

    void poll();
    intervalRef.current = window.setInterval(poll, 4000);
    return () => {
      active = false;
      window.clearInterval(intervalRef.current);
    };
  }, [publicId, token]);

  function copyLetter() {
    if (!result?.generatedLetter) {
      return;
    }
    void navigator.clipboard.writeText(result.generatedLetter);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  function downloadLetter() {
    if (!result?.generatedLetter) {
      return;
    }
    const blob = new Blob([result.generatedLetter], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "ugyfelkozpont-level.txt";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  let statusMessage = "A fizetés ellenőrzése folyamatban...";
  if (result?.paymentStatus === "paid" && result.aiStatus === "generating") {
    statusMessage = "A levele készül...";
  }
  if (result?.aiStatus === "failed_review") {
    statusMessage =
      "A levél automatikus minőségellenőrzése nem sikerült. Amennyiben fizetett, a visszatérítés 5–10 munkanapon belül megjelenik kártyáján.";
  }
  if (result?.aiStatus === "failed") {
    statusMessage =
      "Technikai hiba történt a generálás során. Amennyiben fizetett, a visszatérítés 5–10 munkanapon belül megjelenik kártyáján.";
  }

  const isRefunded = result?.paymentStatus === "refunded";
  const isError =
    result?.aiStatus === "failed" || result?.aiStatus === "failed_review";
  const pageTitle = isError ? "Hiba a levélgenerálás során" : "Sikeres fizetés";

  return (
    <section className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <h1 className="text-3xl font-semibold">{pageTitle}</h1>
      <LegalNotice />

      {!publicId || !token ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-5 text-rose-700">
          Hiányzik a rendelés azonosítója vagy a hozzáférési token.
        </div>
      ) : isRefunded ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
            <p className="font-semibold text-amber-900">A megrendelés visszatérítve</p>
            <p className="mt-1 text-sm text-amber-700">
              A fizetett összeg visszatérítésre kerül bankszámlájára — ez általában 5–10 munkanapon belül megtörténik.
              Küldtünk egy visszaigazoló emailt is.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link className="button-primary" to="/level-keszites">
              Újra megrendelem
            </Link>
            <Link className="button-secondary" to="/kapcsolat">
              Kapcsolatfelvétel
            </Link>
          </div>
        </div>
      ) : result?.aiStatus === "completed" && result.generatedLetter ? (
        <div className="space-y-5">
          <div>
            <h2 className="text-2xl font-semibold">Elkészült a levele</h2>
            <p className="mt-2 text-slate-600">
              Az alábbi szöveget kimásolhatja vagy letöltheti.
            </p>
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50">
            <pre className="whitespace-pre-wrap p-5 text-sm leading-7">
              {result.generatedLetter}
            </pre>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <button className="button-primary" onClick={copyLetter}>
              <Copy size={18} />
              {copied ? "Kimásolva" : "Másolás"}
            </button>
            <button className="button-secondary" onClick={downloadLetter}>
              <Download size={18} />
              Letöltés .txt
            </button>
            <Link className="button-secondary" to="/level-keszites">
              Új levél készítése
            </Link>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 p-5">
          <div className="flex items-center gap-3">
            {!result || result.aiStatus === "generating" ? (
              <LoaderCircle className="shrink-0 animate-spin text-azure-600" size={20} />
            ) : null}
            <p>{statusMessage}</p>
          </div>
          {isError && (
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <Link className="button-primary" to="/level-keszites">
                Újra megrendelem
              </Link>
              <Link className="button-secondary" to="/kapcsolat">
                Kapcsolatfelvétel
              </Link>
            </div>
          )}
          {error && <p className="mt-3 text-sm text-rose-700">{error}</p>}
        </div>
      )}
    </section>
  );
}
