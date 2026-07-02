export type PackageId = "basic" | "premium" | "premium_plus";

export interface IndividualBillingDetails {
  buyerType: "individual";
  name: string;
  email: string;
  country: "HU";
  postalCode: string;
  city: string;
  addressLine1: string;
}

export interface BusinessBillingDetails {
  buyerType: "business";
  name: string;
  email: string;
  country: "HU";
  postalCode: string;
  city: string;
  addressLine1: string;
  taxNumber: string;
}

export type BillingDetails = IndividualBillingDetails | BusinessBillingDetails;

export interface LetterFormValues {
  name: string;
  email: string;
  letterType: string;
  recipient: string;
  problemDescription: string;
  desiredResult: string;
  tone: string;
  previousMessages: string;
  selectedPackage: PackageId;
  checkoutAttemptId: string;
  billing: BillingDetails;
  legalAccepted: boolean;
  turnstileToken: string;
  demoAccessCode?: string;
}

export interface OrderResult {
  paymentStatus:
    | "pending"
    | "checkout_created"
    | "paid"
    | "failed"
    | "cancelled"
    | "expired"
    | "amount_mismatch"
    | "currency_mismatch"
    | "partially_refunded"
    | "refunded";
  invoiceStatus:
    | "not_required"
    | "pending"
    | "processing"
    | "created"
    | "failed"
    | "retry_required"
    | "already_created";
  aiStatus:
    | "not_started"
    | "generating"
    | "completed"
    | "failed"
    | "failed_review";
  generationCount: number;
  generatedLetter?: string;
  letterHistory?: string[];
  letterEmailSent?: boolean;
  selectedPackage: PackageId;
  createdAt: string;
}
