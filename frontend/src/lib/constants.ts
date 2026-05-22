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
    name: "Alap levél",
    price: "1 990 Ft",
    numericPrice: 1990,
    bullets: [
      "1 hivatalos levél",
      "Kulturált, határozott megfogalmazás",
      "Másolható és letölthető szöveg",
      "Egyszerűbb panaszhoz vagy reklamációhoz",
    ],
  },
  premium: {
    name: "Prémium levél",
    price: "4 990 Ft",
    numericPrice: 4990,
    bullets: [
      "Részletesebb megfogalmazás",
      "Alternatív tárgymező",
      "Alternatív zárómondat",
      "Rövid használati javaslat",
      "Komolyabb ügyekhez",
    ],
  },
  business: {
    name: "Céges csomag",
    price: "19 900 Ft",
    recurring: "/ hó",
    numericPrice: 19900,
    bullets: [
      "Havi 10 üzleti levél",
      "Ajánlatkérés",
      "Reklamáció",
      "Válaszlevél",
      "Fizetési felszólítás",
      "Céges hangvétel",
    ],
  },
};
