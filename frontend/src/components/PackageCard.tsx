import { Check } from "lucide-react";
import type { PackageId } from "../lib/types";
import { packages } from "../lib/constants";

export function PackageCard({
  packageId,
  selected,
  onSelect,
}: {
  packageId: PackageId;
  selected?: boolean;
  onSelect?: (packageId: PackageId) => void;
}) {
  const item = packages[packageId];
  return (
    <button
      type="button"
      onClick={() => onSelect?.(packageId)}
      className={`w-full rounded-lg border p-5 text-left transition ${
        selected
          ? "border-azure-600 bg-azure-100 shadow-soft"
          : "border-slate-200 bg-white hover:border-slate-300"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">{item.name}</h3>
          <p className="mt-2 text-2xl font-semibold">
            {item.price}{" "}
            {item.recurring && (
              <span className="text-sm font-medium text-slate-500">
                {item.recurring}
              </span>
            )}
          </p>
        </div>
        {selected && (
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-azure-600 text-white">
            <Check size={16} />
          </span>
        )}
      </div>
      <ul className="mt-4 space-y-2 text-sm text-slate-600">
        {item.bullets.map((bullet) => (
          <li className="flex gap-2" key={bullet}>
            <Check className="mt-0.5 shrink-0 text-mint-600" size={16} />
            <span>{bullet}</span>
          </li>
        ))}
      </ul>
    </button>
  );
}
