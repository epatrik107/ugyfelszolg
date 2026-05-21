import { z } from "zod";

const trimmed = (min: number, max: number) =>
  z.string().trim().min(min).max(max);

export const letterTypeValues = [
  "Panaszlevél",
  "Reklamáció",
  "Fizetési felszólítás",
  "Hivatalos válaszlevél",
  "Szolgáltatói vita",
  "Webáruházas probléma",
  "Bérleti ügy",
  "Munkahelyi ügy",
  "Egyéb",
] as const;

export const toneValues = [
  "Udvarias",
  "Határozott",
  "Nagyon hivatalos",
  "Rövid és lényegre törő",
] as const;

export const selectedPackageValues = ["basic", "premium", "business"] as const;

export const checkoutSchema = z.object({
  name: trimmed(2, 120),
  email: z.string().trim().email().max(254),
  letterType: z.enum(letterTypeValues),
  recipient: trimmed(2, 180),
  problemDescription: trimmed(30, 3000),
  desiredResult: trimmed(10, 1200),
  tone: z.enum(toneValues),
  previousMessages: z.string().trim().max(3000).optional().default(""),
  attachedLetter: z.string().trim().max(6000).optional().default(""),
  selectedPackage: z.enum(selectedPackageValues),
  legalAccepted: z.literal(true),
  turnstileToken: z.string().trim().max(2048).optional().default(""),
  demoAccessCode: z.string().trim().max(200).optional().default(""),
});

export const businessOrderSchema = checkoutSchema
  .omit({
    selectedPackage: true,
    turnstileToken: true,
    demoAccessCode: true,
  })
  .extend({
    selectedPackage: z.literal("business").optional().default("business"),
  });

export const contactSchema = z.object({
  name: trimmed(2, 120),
  email: z.string().trim().email().max(254),
  message: trimmed(10, 3000),
  turnstileToken: trimmed(1, 2048),
});

export const accessLinkSchema = z.object({
  email: z.string().trim().email().max(254),
  turnstileToken: trimmed(1, 2048),
});

export const exchangeMagicLinkSchema = z.object({
  token: trimmed(20, 512),
});
