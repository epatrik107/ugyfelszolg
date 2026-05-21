import { Turnstile } from "@marsidev/react-turnstile";
import { TURNSTILE_SITE_KEY } from "../lib/config";

export function TurnstileField({
  onSuccess,
}: {
  onSuccess: (token: string) => void;
}) {
  if (!TURNSTILE_SITE_KEY) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        A Turnstile site key még nincs beállítva.
      </div>
    );
  }

  return (
    <Turnstile
      siteKey={TURNSTILE_SITE_KEY}
      onSuccess={onSuccess}
      options={{ theme: "light" }}
    />
  );
}
