import type { IndividualBillingDetails, PackageId } from "./types";
import { getPackage } from "./packages";

const BUSINESS_NAME_PATTERN =
  /(?:^|[\s,.\-()])(?:kft|zrt|nyrt|bt|kkt|ev|e\.v|egyéni\s+vállalkozó|ltd|limited|llc|inc|corp|gmbh|s\.r\.o|sro)(?:$|[\s,.\-()])/iu;

const TAX_KEYS = new Set([
  "taxnumber",
  "taxid",
  "vatid",
  "euvatid",
  "adoszam",
  "adószám",
  "adoszameu",
]);

const BUSINESS_KEYS = new Set([
  "company",
  "companyname",
  "business",
  "businessname",
  "organization",
  "organizationname",
  "organisation",
  "organisationname",
  "cegnev",
  "cégnév",
]);

const PRICE_KEYS = new Set([
  "price",
  "amount",
  "currency",
  "discount",
  "discountamount",
  "coupon",
  "promotioncode",
]);

function normalizeKey(key: string) {
  return key.toLocaleLowerCase("hu-HU").replace(/[_\-\s]/g, "");
}

export type SuspiciousCheckoutInput =
  | "tax_data"
  | "business_data"
  | "business_buyer_type"
  | "manipulated_price"
  | null;

export function detectSuspiciousCheckoutInput(value: unknown): SuspiciousCheckoutInput {
  if (!value || typeof value !== "object") return null;

  for (const [rawKey, child] of Object.entries(value as Record<string, unknown>)) {
    const key = normalizeKey(rawKey);
    if (TAX_KEYS.has(key)) return "tax_data";
    if (BUSINESS_KEYS.has(key)) return "business_data";
    if (PRICE_KEYS.has(key)) return "manipulated_price";
    if (
      key === "buyertype" &&
      typeof child === "string" &&
      child.toLocaleLowerCase("en-US") !== "individual"
    ) {
      return "business_buyer_type";
    }
    const nested = detectSuspiciousCheckoutInput(child);
    if (nested) return nested;
  }
  return null;
}

export function looksLikeBusinessName(name: string) {
  return BUSINESS_NAME_PATTERN.test(name.trim());
}

export function assertIndividualBilling(details: IndividualBillingDetails) {
  if (details.buyerType !== "individual" || looksLikeBusinessName(details.name)) {
    throw new Error("BUSINESS_BUYER_NOT_ALLOWED");
  }
  if (details.country !== "HU") {
    // Prices currently contain Hungarian VAT. Restricting the market to HU is
    // safer than issuing an invoice with an incorrect cross-border VAT rate.
    throw new Error("UNSUPPORTED_BILLING_COUNTRY");
  }
}

export interface PriceBreakdown {
  packageId: PackageId;
  grossAmount: number;
  discountAmount: 0;
  payableAmount: number;
  currency: "huf";
  vatRate: 27;
}

export function calculateOrderPrice(packageId: PackageId): PriceBreakdown {
  const selectedPackage = getPackage(packageId);
  if (!Number.isSafeInteger(selectedPackage.price) || selectedPackage.price <= 0) {
    throw new Error("INVALID_PAYABLE_AMOUNT");
  }
  if (selectedPackage.currency !== "huf") {
    throw new Error("UNSUPPORTED_CURRENCY");
  }
  return {
    packageId,
    grossAmount: selectedPackage.price,
    discountAmount: 0,
    payableAmount: selectedPackage.price,
    currency: "huf",
    vatRate: 27,
  };
}

export function calculateHufB2cVat(grossAmount: number, vatRate = 27) {
  if (!Number.isSafeInteger(grossAmount) || grossAmount <= 0) {
    throw new Error("INVALID_GROSS_AMOUNT");
  }
  if (!Number.isSafeInteger(vatRate) || vatRate < 0) {
    throw new Error("INVALID_VAT_RATE");
  }
  const vatAmount = Math.round((grossAmount / (100 + vatRate)) * vatRate);
  const netAmount = grossAmount - vatAmount;
  return { netAmount, vatAmount, grossAmount, vatRate };
}
