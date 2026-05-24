export type PackageId = "basic" | "premium" | "premium_plus";

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
  generationCount: number;
  generatedLetter?: string;
  letterHistory?: string[];
  letterEmailSent?: boolean;
  selectedPackage: PackageId;
  createdAt: string;
}
