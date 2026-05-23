import type { PackageId } from "./types";

export interface PackageCapabilities {
  /** Maximum number of user-initiated regenerations per order (0 = no regen). */
  maxRegenerations: number;
  /** Whether email delivery is triggered automatically (vs. user-initiated). */
  sendsEmailByDefault: boolean;
  /** Whether an alternative subject line is generated alongside the letter. */
  hasAlternatives: boolean;
  /** Whether a short usage-tip section is appended to the letter output. */
  hasUsageTips: boolean;
  /** Whether to use the premium-tier Gemini model for generation. */
  isPremiumModel: boolean;
}

export const PACKAGES = {
  basic: {
    id: "basic",
    name: "Alap levél",
    price: 1990,
    currency: "huf",
    billingMode: "payment",
    capabilities: {
      maxRegenerations: 1,
      sendsEmailByDefault: false,
      hasAlternatives: false,
      hasUsageTips: false,
      isPremiumModel: false,
    } satisfies PackageCapabilities,
  },
  premium: {
    id: "premium",
    name: "Prémium levél",
    price: 4990,
    currency: "huf",
    billingMode: "payment",
    capabilities: {
      maxRegenerations: 3,
      sendsEmailByDefault: false,
      hasAlternatives: true,
      hasUsageTips: true,
      isPremiumModel: true,
    } satisfies PackageCapabilities,
  },
  business: {
    id: "business",
    name: "Céges csomag",
    price: 19900,
    currency: "huf",
    billingMode: "subscription",
    quotaPerPeriod: 10,
    capabilities: {
      maxRegenerations: 3,
      sendsEmailByDefault: false,
      hasAlternatives: true,
      hasUsageTips: true,
      isPremiumModel: true,
    } satisfies PackageCapabilities,
  },
} as const;

export function isPackageId(value: string): value is PackageId {
  return value in PACKAGES;
}

export function getPackage(packageId: PackageId) {
  return PACKAGES[packageId];
}
