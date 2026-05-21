import { legalNotice } from "../lib/constants";

export function LegalNotice({ compact = false }: { compact?: boolean }) {
  return (
    <p
      className={
        compact
          ? "max-w-3xl text-sm leading-6 text-slate-600"
          : "rounded-md border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700"
      }
    >
      {legalNotice}
    </p>
  );
}
