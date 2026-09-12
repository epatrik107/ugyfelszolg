import { Turnstile } from "@marsidev/react-turnstile";
import { useState } from "react";
import { TURNSTILE_SITE_KEY } from "../lib/config";

export function TurnstileField({
  onSuccess,
  action,
}: {
  onSuccess: (token: string) => void;
  action: "checkout" | "contact";
}) {
  const [failed, setFailed] = useState(false);

  if (!TURNSTILE_SITE_KEY) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        A Turnstile site key még nincs beállítva.
      </div>
    );
  }

  if (failed) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        A biztonsági ellenőrzés nem töltődött be. Az űrlap adatai megmaradtak.
        <button type="button" className="button-secondary mt-3 w-full" onClick={() => setFailed(false)}>Ellenőrzés újrapróbálása</button>
      </div>
    );
  }

  return (
    <Turnstile
      siteKey={TURNSTILE_SITE_KEY}
      onSuccess={onSuccess}
      onExpire={() => onSuccess("")}
      onError={() => {
        onSuccess("");
        setFailed(true);
      }}
      options={{ theme: "light", action, size: "compact" }}
    />
  );
}
