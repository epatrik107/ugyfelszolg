import type { PackageId } from "./types";

export const PACKAGES = {
  basic: {
    id: "basic",
    name: "Alap levél",
    price: 1990,
    currency: "huf",
    billingMode: "payment",
  },
  premium: {
    id: "premium",
    name: "Prémium levél",
    price: 4990,
    currency: "huf",
    billingMode: "payment",
  },
  business: {
    id: "business",
    name: "Céges csomag",
    price: 19900,
    currency: "huf",
    billingMode: "subscription",
    quotaPerPeriod: 10,
  },
} as const;

export function isPackageId(value: string): value is PackageId {
  return value in PACKAGES;
}

export function getPackage(packageId: PackageId) {
  return PACKAGES[packageId];
}
