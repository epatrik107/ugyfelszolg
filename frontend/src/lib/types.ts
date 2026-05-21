export type PackageId = "basic" | "premium" | "business";

export interface LetterFormValues {
  name: string;
  email: string;
  letterType: string;
  recipient: string;
  problemDescription: string;
  desiredResult: string;
  tone: string;
  previousMessages: string;
  attachedLetter?: string;
  selectedPackage: PackageId;
  legalAccepted: boolean;
  turnstileToken: string;
  demoAccessCode?: string;
}

export interface OrderResult {
  paymentStatus: "pending" | "paid" | "failed" | "expired" | "refunded";
  aiStatus:
    | "not_started"
    | "generating"
    | "completed"
    | "failed"
    | "failed_review";
  generatedLetter?: string;
  selectedPackage: PackageId;
  createdAt: string;
}

export interface BusinessSession {
  email: string;
  status: string;
  quota: number;
  used: number;
  reserved: number;
  remaining: number;
  periodStart: string;
  periodEnd: string;
}
