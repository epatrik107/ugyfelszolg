import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { cancelCheckoutSession } from "../lib/api";
import {
  readResultCapabilityToken,
  removeResultCapabilityFromBrowserUrl,
} from "../lib/resultCapability";

export function CancelPage() {
  const [searchParams] = useSearchParams();
  const publicId = searchParams.get("order") ?? "";
  const incomingToken = readResultCapabilityToken(searchParams, window.location.hash) ?? "";
  const [token] = useState(incomingToken);
  const [cancelState, setCancelState] = useState<"pending" | "done" | "failed">(
    publicId && token ? "pending" : "failed",
  );

  useEffect(() => {
    if (!incomingToken) return;
    removeResultCapabilityFromBrowserUrl();
  }, [incomingToken]);

  useEffect(() => {
    if (!publicId || !token) return;
    void cancelCheckoutSession(publicId, token)
      .then(() => setCancelState("done"))
      .catch(() => setCancelState("failed"));
  }, [publicId, token]);

  return (
    <section className="mx-auto max-w-2xl space-y-6 px-4 py-14">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
        <p className="text-lg font-semibold text-amber-900">A fizetés megszakadt</p>
        <p className="mt-1 text-sm text-amber-700">
          A szolgáltatás nem aktiválódott és számla nem készült.
          {cancelState === "pending" && " A fizetési munkamenet biztonságos lezárása folyamatban van."}
          {cancelState === "done" && " A fizetési munkamenetet lezártuk."}
          {cancelState === "failed" && " A munkamenet automatikusan lejár; kérjük, ne nyissa meg újra a fizetési oldalt."}
        </p>
      </div>

      <p className="text-sm text-slate-600">
        Új próbálkozáshoz indítson új rendelést. Sikertelen vagy megszakított fizetésre nem készül számla.
      </p>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Link className="button-primary" to="/level-keszites">Újrapróbálom</Link>
        <Link className="button-secondary" to="/kapcsolat">Kapcsolatfelvétel</Link>
        <Link className="button-secondary" to="/">Vissza a főoldalra</Link>
      </div>
    </section>
  );
}
