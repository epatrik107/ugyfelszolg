import type { BillingDetails, PackageId } from "./types";
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

const ALLOWED_BILLING_BUSINESS_KEYS = new Set([
  "buyertype",
  "name",
  "email",
  "country",
  "postalcode",
  "city",
  "addressline1",
  "taxnumber",
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
  | "invalid_structure"
  | null;

const MAX_CHECKOUT_OBJECT_DEPTH = 16;
const MAX_CHECKOUT_OBJECT_NODES = 512;

export function isValidHungarianTaxNumber(value: string) {
  return /^\d{8}-\d-\d{2}$/u.test(value.trim());
}

export function detectSuspiciousCheckoutInput(
  value: unknown,
): SuspiciousCheckoutInput {
  if (!value || typeof value !== "object") return null;

  const stack: Array<{ value: object; path: string[]; depth: number }> = [
    { value, path: [], depth: 0 },
  ];
  const seen = new WeakSet<object>();
  let visitedNodes = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    if (seen.has(current.value)) return "invalid_structure";
    seen.add(current.value);
    visitedNodes += 1;
    if (
      current.depth > MAX_CHECKOUT_OBJECT_DEPTH ||
      visitedNodes > MAX_CHECKOUT_OBJECT_NODES
    ) {
      return "invalid_structure";
    }

    const record = current.value as Record<string, unknown>;
    for (const [rawKey, child] of Object.entries(record)) {
      const key = normalizeKey(rawKey);
      const childPath = [...current.path, key];
      const isBillingField = current.path.length === 1 && current.path[0] === "billing";
      const isAllowedBusinessTaxNumber =
        isBillingField &&
        key === "taxnumber" &&
        typeof record.buyerType === "string" &&
        record.buyerType.toLocaleLowerCase("en-US") === "business";
      if (
        TAX_KEYS.has(key) &&
        (!isAllowedBusinessTaxNumber || !ALLOWED_BILLING_BUSINESS_KEYS.has(key))
      ) {
        return "tax_data";
      }
      if (
        BUSINESS_KEYS.has(key) &&
        (!isBillingField || !ALLOWED_BILLING_BUSINESS_KEYS.has(key))
      ) {
        return "business_data";
      }
      if (PRICE_KEYS.has(key)) return "manipulated_price";
      if (
        key === "buyertype" &&
        typeof child === "string" &&
        !["individual", "business"].includes(child.toLocaleLowerCase("en-US"))
      ) {
        return "business_buyer_type";
      }
      if (child && typeof child === "object") {
        stack.push({ value: child, path: childPath, depth: current.depth + 1 });
      }
    }
  }
  return null;
}

export function looksLikeBusinessName(name: string) {
  return BUSINESS_NAME_PATTERN.test(name.trim());
}

export function assertBillingDetails(details: BillingDetails) {
  if (details.buyerType === "individual" && looksLikeBusinessName(details.name)) {
    throw new Error("BUSINESS_BUYER_NOT_ALLOWED");
  }
  if (details.buyerType === "business" && !isValidHungarianTaxNumber(details.taxNumber)) {
    throw new Error("INVALID_BUSINESS_TAX_NUMBER");
  }
  if (details.country !== "HU") {
    // The current invoice flow is explicitly configured for the seller's
    // Hungarian AAM tax status. Cross-border tax rules are not implemented.
    throw new Error("UNSUPPORTED_BILLING_COUNTRY");
  }
}

export const SELLER_VAT_CODE = "AAM" as const;

export interface PriceBreakdown {
  packageId: PackageId;
  grossAmount: number;
  discountAmount: 0;
  payableAmount: number;
  currency: "huf";
  vatCode: typeof SELLER_VAT_CODE;
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
    vatCode: SELLER_VAT_CODE,
  };
}

export function calculateAamInvoiceAmounts(payableAmount: number) {
  if (!Number.isSafeInteger(payableAmount) || payableAmount <= 0) {
    throw new Error("INVALID_GROSS_AMOUNT");
  }
  return {
    netAmount: payableAmount,
    vatAmount: 0,
    grossAmount: payableAmount,
    vatCode: SELLER_VAT_CODE,
  };
}
