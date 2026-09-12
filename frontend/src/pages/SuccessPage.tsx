import { CheckCircle2, LoaderCircle, Mail, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { LetterDocument } from "../components/LetterDocument";
import { getOrderResult, requestRegeneration, sendLetterByEmail } from "../lib/api";
import { packages } from "../lib/constants";
import {
  getRemainingRegenerationMessage,
  getRemainingRegenerations,
} from "../lib/regeneration";
import {
  readResultCapabilityToken,
  removeResultCapabilityFromBrowserUrl,
} from "../lib/resultCapability";
import type { OrderResult } from "../lib/types";

type StepStatus = "pending" | "active" | "done" | "error";

function ProgressStep({
  label,
  status,
}: {
  label: string;
  status: StepStatus;
}) {
  return (
    <div className="flex items-center gap-2">
      {status === "done" ? (
        <CheckCircle2 className="shrink-0 text-emerald-500" size={18} />
      ) : status === "active" ? (
        <LoaderCircle className="shrink-0 animate-spin text-azure-500" size={18} />
      ) : status === "error" ? (
        <span className="shrink-0 text-rose-500 text-base">✕</span>
      ) : (
        <span className="shrink-0 h-[18px] w-[18px] rounded-full border-2 border-slate-300" />
      )}
      <span
        className={
          status === "done"
            ? "text-sm text-emerald-700 font-medium"
            : status === "active"
              ? "text-sm text-slate-800 font-medium"
              : "text-sm text-slate-400"
        }
      >
        {label}
      </span>
    </div>
  );
}

function GenerationProgress({ result }: { result: OrderResult | null }) {
  const paid = result?.paymentStatus === "paid" || result?.paymentStatus === "partially_refunded";
  const failed = result?.aiStatus === "failed" || result?.aiStatus === "failed_review";
  const complete = result?.aiStatus === "completed";
  const paymentPending = !result || ["pending", "checkout_created"].includes(result.paymentStatus);
  return <div aria-label="A rendelés állapota" className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-5">
    <ProgressStep label={paid ? "Fizetés visszaigazolva" : "Fizetés ellenőrzése"} status={paid ? "done" : paymentPending ? "active" : "error"} />
    <ProgressStep label={paid && result?.aiStatus === "not_started" ? "A levél feldolgozásra vár" : "Levél elkészítése és minőségellenőrzése"} status={complete ? "done" : failed ? "error" : paid ? "active" : "pending"} />
    <ProgressStep label="A levél megnyitható" status={complete ? "done" : "pending"} />
  </div>;
}

export function SuccessPage() {
  const [searchParams] = useSearchParams();
  const publicId = searchParams.get("order") ?? "";
  const incomingToken = useMemo(
    () => readResultCapabilityToken(searchParams, window.location.hash),
    [searchParams],
  );
  const storageKey = useMemo(() => `result-token:${publicId}`, [publicId]);
  const [token, setToken] = useState<string | null>(
    incomingToken || sessionStorage.getItem(storageKey),
  );
  const [result, setResult] = useState<OrderResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [regenBusy, setRegenBusy] = useState(false);
  const [regenFeedback, setRegenFeedback] = useState("");
  const [regenError, setRegenError] = useState<string | null>(null);
  const [sendingVersion, setSendingVersion] = useState<"current" | number | null>(null);
  const [sentVersions, setSentVersions] = useState<Set<"current" | number>>(new Set());
  const [sendEmailError, setSendEmailError] = useState<string | null>(null);
  const [pollKey, setPollKey] = useState(0);
  const intervalRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (incomingToken) {
      sessionStorage.setItem(storageKey, incomingToken);
      setToken(incomingToken);
      removeResultCapabilityFromBrowserUrl();
    }
  }, [incomingToken, storageKey]);

  const MAX_POLL_ATTEMPTS = 60; // Under 120 requests/10 min, with backoff and no overlapping fetches
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
        setRegenError(payload.regenerationError ?? null);
        setError(null);
        const isTerminal =
          payload.aiStatus === "completed" ||
          payload.aiStatus === "failed" ||
          payload.aiStatus === "failed_review" ||
          payload.paymentStatus === "refunded" ||
          payload.paymentStatus === "cancelled" ||
          payload.paymentStatus === "expired" ||
          payload.paymentStatus === "amount_mismatch" ||
          payload.paymentStatus === "currency_mismatch" ||
          payload.paymentStatus === "chargeback_open" ||
          payload.paymentStatus === "chargeback_lost" ||
          payload.paymentStatus === "chargeback_won";
        if (isTerminal || pollCountRef.current >= MAX_POLL_ATTEMPTS) {
          window.clearTimeout(intervalRef.current);
          if (!isTerminal && pollCountRef.current >= MAX_POLL_ATTEMPTS) {
            setError(
              "A generálás a vártnál hosszabb ideig tart. Töltse újra az oldalt néhány perc múlva, vagy vegye fel velünk a kapcsolatot.",
            );
          }
        } else {
          intervalRef.current = window.setTimeout(poll, Math.min(4000 + pollCountRef.current * 1000, 15000));
        }
      } catch (pollError) {
        if (active) {
          window.clearTimeout(intervalRef.current);
          setError(pollError instanceof Error ? pollError.message : "Ismeretlen hiba.");
        }
      }
    }

    void poll();

    return () => {
      active = false;
      window.clearTimeout(intervalRef.current);
    };
    // pollKey causes this effect to restart polling after regeneration
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicId, token, pollKey])

  useEffect(() => {
    setSentVersions((prev) => {
      const next = new Set(prev);
      if (result?.letterEmailSent) next.add("current");
      else next.delete("current");
      return next;
    });
  }, [result?.letterEmailSent]);

  const retryPolling = useCallback(() => {
    setError(null);
    setPollKey((k) => k + 1);
  }, []);

  async function handleSendEmail(version: "current" | number = "current") {
    if (!publicId || !token) return;
    setSendingVersion(version);
    setSendEmailError(null);
    try {
      await sendLetterByEmail(publicId, token, version === "current" ? undefined : version);
      setSentVersions((prev) => new Set([...prev, version]));
    } catch (err) {
      setSendEmailError(err instanceof Error ? err.message : "Az email küldése nem sikerült.");
    } finally {
      setSendingVersion(null);
    }
  }

  async function handleRegenerate(preset?: string) {
    if (!publicId || !token || regenBusy || result?.aiStatus !== "completed") return;
    const feedback = (preset ?? regenFeedback).trim();
    if (feedback.length < 5) {
      setRegenError("Írja le legalább 5 karakterrel, mit szeretne megváltoztatni.");
      return;
    }

    setRegenBusy(true);
    setRegenError(null);
    try {
      await requestRegeneration(publicId, token, feedback);
      setResult((prev) => prev ? { ...prev, aiStatus: "generating", regenerationError: undefined } : prev);
      setSentVersions(new Set());
      setRegenFeedback("");
      // Restart polling via pollKey — this cleans up the old interval and starts fresh
      setPollKey((k) => k + 1);
    } catch (err) {
      setRegenError(err instanceof Error ? err.message : "A módosítás nem sikerült. Kérjük, próbálja újra.");
    } finally {
      setRegenBusy(false);
    }
  }

  const packageMaxRegenerations = result
    ? packages[result.selectedPackage].maxRegenerations
    : 0;
  const remainingRegenerations = result
    ? getRemainingRegenerations(result.generationCount ?? 0, packageMaxRegenerations)
    : 0;

  const regenerationMessage = getRemainingRegenerationMessage(
    remainingRegenerations,
    packageMaxRegenerations,
  );

  let statusMessage = "A fizetés ellenőrzése folyamatban...";
  if (result?.paymentStatus === "paid") {
    statusMessage = result.aiStatus === "not_started" ? "A fizetését visszaigazoltuk. A levele feldolgozásra vár." : "A levele készül, az automatikus minőségellenőrzéssel együtt.";
  }
  const refundNeedsManualFollowup =
    result?.refundStatus === "failed" ||
    result?.refundStatus === "canceled" ||
    result?.refundStatus === "requires_action";
  const refundInProgress =
    result?.refundStatus === "pending" || result?.refundStatus === "unknown";
  if (result?.aiStatus === "failed_review") {
    statusMessage =
      "A levél automatikus minőségellenőrzése nem sikerült.";
  }
  if (result?.aiStatus === "failed") {
    statusMessage =
      "Technikai hiba történt a generálás során.";
  }
  if (refundInProgress) {
    statusMessage += " A visszatérítést elindítottuk, a Stripe visszaigazolására várunk.";
  }
  if (refundNeedsManualFollowup) {
    statusMessage += " Az automatikus visszatérítés nem zárult le; kérjük, vegye fel velünk a kapcsolatot.";
  }
  if (result?.refundStatus === "succeeded" && result.paymentStatus !== "refunded") {
    statusMessage += " A részleges visszatérítést a Stripe visszaigazolta.";
  }
  if (result?.paymentStatus === "chargeback_open") {
    statusMessage =
      "A fizetés vitatott tranzakcióként van nyilvántartva, ezért a hozzáférés átmenetileg szünetel. Kérjük, vegye fel velünk a kapcsolatot.";
  }
  if (result?.paymentStatus === "chargeback_lost") {
    statusMessage =
      "A fizetés vitatott tranzakciója lezárult, a hozzáférés nem aktív. Kérjük, vegye fel velünk a kapcsolatot.";
  }
  if (result?.paymentStatus === "chargeback_won") {
    statusMessage =
      "A fizetési vita lezárult, a rendelés hozzáférése újra aktív.";
  }

  const isRefunded = result?.paymentStatus === "refunded";
  const isError =
    result?.aiStatus === "failed" || result?.aiStatus === "failed_review";
  const hasChargebackIssue =
    result?.paymentStatus === "chargeback_open" ||
    result?.paymentStatus === "chargeback_lost";
  const paymentStopped = !!result && ["failed", "cancelled", "expired", "amount_mismatch", "currency_mismatch"].includes(result.paymentStatus);
  if (paymentStopped) statusMessage = "A fizetés nem zárult le sikeresen. Ha terhelést lát, új fizetés helyett keresse ügyfélszolgálatunkat a rendelés azonosítójával.";
  const pageTitle = hasChargebackIssue
    ? "Fizetési vita folyamatban"
    : isError ? "Hiba a levélgenerálás során" : result?.generatedLetter ? "Elkészült a levele" : "Rendelés állapota";

  return (
    <section className="mx-auto max-w-4xl space-y-6 px-4 py-10">
      <h1 className="text-3xl font-semibold">{pageTitle}</h1>
      <p className="text-sm text-slate-600">A levelet AI készíti. Elküldés előtt ellenőrizze a szöveget és az adatokat; a szolgáltatás nem minősül jogi tanácsadásnak.</p>
      {result?.paymentStatus === "paid" &&
        (result.invoiceStatus === "failed" || result.invoiceStatus === "retry_required") && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            A fizetés sikeres és a szolgáltatás aktív. A számla kiállítása átmenetileg nem sikerült;
            a rendszer biztonságosan megőrizte az állapotot, és újrapróbálja, vagy ügyintézői beavatkozást kér.
          </div>
        )}

      {!publicId || !token ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-5 text-rose-700">
          A levél megnyitásához használja a visszaigazoló emailben kapott teljes hivatkozást. Ha nem találja, kérjen segítséget a Kapcsolat oldalon.
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
      ) : result?.generatedLetter ? (
        <div className="space-y-5">
          {result.aiStatus === "generating" && (
            <p role="status" className="rounded-lg bg-azure-50 p-4 text-sm text-azure-700">
              A módosítás folyamatban van. Addig a korábbi levél továbbra is elérhető.
            </p>
          )}
          <div>
            <h2 className="text-xl font-semibold">Olvassa át, majd használja a levelet</h2>
            <p className="mt-2 text-slate-600">
              Az alábbi szöveget kimásolhatja, letöltheti, vagy elküldheti emailben.
            </p>
          </div>
          <LetterDocument original={result.generatedLetter} history={result.letterHistory} />
          {error && <div role="alert" className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">{error}<button className="button-secondary mt-2" onClick={retryPolling}>Állapot újraellenőrzése</button></div>}

          {/* Send by email */}
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 space-y-3">
            <p className="text-sm font-medium text-emerald-900">Mentett levélváltozat küldése saját emailcímére</p>
            <p className="text-sm text-emerald-700">
              Az alábbi mentett változatok közül választhat. A kézzel szerkesztett szöveget a Másolás vagy Letöltés gombbal használhatja.
            </p>
            {sendEmailError && (
              <p className="text-sm text-rose-700">{sendEmailError}</p>
            )}
            <div className="flex flex-col gap-2">
              {/* Current version send button */}
              <div className="flex items-center justify-between rounded border border-emerald-200 bg-white px-3 py-2">
                <span className="text-sm font-medium text-slate-700">
                  {(result.letterHistory?.length ?? 0) > 0
                    ? `${(result.letterHistory?.length ?? 0) + 1}. változat (jelenlegi)`
                    : "Jelenlegi változat"}
                </span>
                <button
                  className="button-primary text-sm py-1.5 px-3"
                  disabled={sendingVersion !== null || result.aiStatus !== "completed"}
                  onClick={() => void handleSendEmail("current")}
                >
                  {sendingVersion === "current" ? (
                    <LoaderCircle className="animate-spin" size={15} />
                  ) : (
                    <Mail size={15} />
                  )}
                  {sentVersions.has("current")
                    ? "Elküldve ✓"
                    : sendingVersion === "current"
                      ? "Küldés..."
                      : "Ezt küldd el"}
                </button>
              </div>
              {/* History version send buttons */}
              {result.letterHistory?.map((_, idx) => (
                <div key={idx} className="flex items-center justify-between rounded border border-slate-200 bg-white px-3 py-2">
                  <span className="text-sm text-slate-600">{idx + 1}. változat (korábbi)</span>
                  <button
                    className="button-secondary text-sm py-1.5 px-3"
                    disabled={sendingVersion !== null || result.aiStatus !== "completed"}
                    onClick={() => void handleSendEmail(idx)}
                  >
                    {sendingVersion === idx ? (
                      <LoaderCircle className="animate-spin" size={15} />
                    ) : (
                      <Mail size={15} />
                    )}
                    {sentVersions.has(idx)
                      ? "Elküldve ✓"
                      : sendingVersion === idx
                        ? "Küldés..."
                        : "Ezt küldd el"}
                  </button>
                </div>
              ))}
            </div>
            {sentVersions.size > 0 && (
              <p className="text-sm text-emerald-700">
                ✓ A levél el lett küldve a megadott email-címre. Ha nem találja, nézze meg a Spam/Levélszemét mappát is.
              </p>
            )}
          </div>

          {/* Regeneration section */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
            <p className="text-sm font-medium text-slate-700">Módosítsuk a levél megfogalmazását?</p>
            {remainingRegenerations > 0 ? (
              <>
                <p className="text-sm text-slate-600">{regenerationMessage}</p>
                <p className="text-sm text-slate-600">Minden alábbi gomb 1 AI-módosítást indít a legújabb mentett levélből. Sikertelen próbálkozáskor a keret visszaáll.</p>
                <div className="flex flex-wrap gap-2">
                  {["Legyen rövidebb", "Legyen határozottabb", "Egyszerűbb nyelvezet"].map((label) => <button key={label} type="button" className="button-secondary text-sm" disabled={regenBusy || result.aiStatus !== "completed"} onClick={() => void handleRegenerate(label)}>{label}</button>)}
                </div>
                <label className="block text-sm font-medium text-slate-700" htmlFor="regen-feedback">
                  Saját módosítási kérés
                </label>
                <textarea
                  id="regen-feedback"
                  className="min-h-28 w-full rounded-md border border-slate-300 px-3 py-2 text-sm leading-6 shadow-sm focus:border-azure-500 focus:outline-none focus:ring-2 focus:ring-azure-200"
                  maxLength={1200}
                  aria-describedby="regen-cost"
                  value={regenFeedback}
                  onChange={(event) => setRegenFeedback(event.target.value)}
                  placeholder="Például: a zárás legyen udvariasabb, és emelje ki a kért megoldást."
                />
                <p id="regen-cost" className="text-xs text-slate-500">Legalább 5 karakter. Indításkor 1 AI-módosítást használ fel.</p>
                <button
                  className="button-secondary"
                  disabled={regenBusy || result.aiStatus !== "completed"}
                  onClick={() => void handleRegenerate()}
                >
                  {regenBusy ? (
                    <LoaderCircle className="animate-spin" size={18} />
                  ) : (
                    <RefreshCw size={18} />
                  )}
                  {regenBusy ? "Módosítás indítása…" : "Saját kérés elküldése"}
                </button>
              </>
            ) : (
              <p className="text-sm text-slate-600">
                {regenerationMessage} A kézi szerkesztést továbbra is használhatja. További segítségért keresse ügyfélszolgálatunkat.
              </p>
            )}
            {regenError && (
              <p role="alert" className="text-sm text-rose-700">{regenError}</p>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <GenerationProgress result={result} />

          <div className="rounded-lg border border-slate-200 p-5">
            <div className="flex items-center gap-3">
              {!result || result.aiStatus === "generating" || result.aiStatus === "not_started" ? (
                <LoaderCircle className="shrink-0 animate-spin text-azure-600" size={20} />
              ) : null}
              <p role="status">{statusMessage}</p>
            </div>
            {(isError || paymentStopped) && (
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <Link className="button-primary" to="/level-keszites">
                  Újra megrendelem
                </Link>
                <Link className="button-secondary" to="/kapcsolat">
                  Kapcsolatfelvétel
                </Link>
              </div>
            )}
            {!isError && !paymentStopped && !hasChargebackIssue && !error && <p className="mt-3 text-sm text-slate-600">Az állapot automatikusan frissül. A feldolgozás több percig is eltarthat; nem kell újra fizetnie.</p>}
            {pollCountRef.current >= 12 && <p className="mt-3 text-sm text-amber-800">Még nincs kész eredmény. Ha segítségre van szüksége, <Link to="/kapcsolat" className="underline">írjon nekünk</Link> a rendelés azonosítójával: <strong className="break-all">{publicId}</strong>.</p>}
            {error && (
              <div className="mt-3 space-y-2">
                <p className="text-sm text-rose-700">{error}</p>
                {(
                  <button
                    className="button-secondary text-sm py-1.5 px-3"
                    onClick={retryPolling}
                  >
                    <RefreshCw size={15} />
                    Újrapróbálom
                  </button>
                )}
                {pollCountRef.current >= MAX_POLL_ATTEMPTS && (
                  <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    <p className="font-medium">A generálás a vártnál hosszabb ideig tart.</p>
                    <p className="mt-1">
                      Kérjük, töltse újra az oldalt néhány perc múlva, vagy{" "}
                      <Link className="underline" to="/kapcsolat">
                        vegye fel velünk a kapcsolatot
                      </Link>
                      , és segítünk.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
