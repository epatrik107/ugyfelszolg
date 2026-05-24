import type { PackageId } from "./types";

export const legalNotice =
  "A szolgáltatás nem minősül jogi, pénzügyi vagy egészségügyi tanácsadásnak. Az elkészített szöveg kommunikációs segítség, amelyet az ügyfél saját felelősségére használ fel.";

/** Must match MAX_REGENERATIONS in worker/src/lib/orderState.ts */
export const MAX_REGENERATIONS = 3;

export const letterTypes = [
  "Panaszlevél",
  "Reklamáció",
  "Fizetési felszólítás",
  "Hivatalos válaszlevél",
  "Szolgáltatói vita",
  "Webáruházas probléma",
  "Bérleti ügy",
  "Munkahelyi ügy",
  "Egyéb",
];

export const tones = [
  "Udvarias",
  "Határozott",
  "Nagyon hivatalos",
  "Rövid és lényegre törő",
];

export const packages: Record<
  PackageId,
  {
    name: string;
    price: string;
    numericPrice: number;
    recurring?: string;
    bullets: string[];
  }
> = {
  basic: {
    name: "Alapcsomag",
    price: "890 Ft",
    numericPrice: 890,
    bullets: [
      "1 hivatalos levél",
      "Kulturált, határozott megfogalmazás",
      "Másolható és letölthető szöveg",
      "Egyszerűbb panaszhoz vagy reklamációhoz",
    ],
  },
  premium: {
    name: "Prémium",
    price: "3 900 Ft",
    numericPrice: 3900,
    bullets: [
      "Részletesebb megfogalmazás",
      "Alternatív tárgymező",
      "Alternatív zárómondat",
      "Rövid használati javaslat",
      "Komolyabb ügyekhez",
    ],
  },
  premium_plus: {
    name: "Prémium plusz",
    price: "10 900 Ft",
    numericPrice: 10900,
    bullets: [
      "Összetettebb ügyekhez",
      "Részletesebb levélváltozat",
      "Alternatív tárgymező és zárás",
      "Rövid használati javaslat",
      "Prémium modell használata",
    ],
  },
};
