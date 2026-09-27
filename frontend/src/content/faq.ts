import { packages } from "../lib/constants";
export const homeFaq = [
  { question: "Mennyi idő alatt készül el a levél?", answer: "A sikeres fizetés igazolása után automatikusan megkezdődik a levél elkészítése. Technikai okok miatt ez néhány percet is igénybe vehet. A kész szöveg az eredményoldalon érhető el, ahol ellenőrizheti és szerkesztheti." },
  { question: "Módosíthatom az elkészült szöveget?", answer: `Igen. A szöveget kézzel átnézheti és szerkesztheti. Az Alapcsomag ${packages.basic.maxRegenerations}, a Prémium ${packages.premium.maxRegenerations}, a Prémium plusz ${packages.premium_plus.maxRegenerations} AI-módosítást tartalmaz. A kézi szerkesztés nem fogyasztja ezt a keretet. Új ügyhöz új megrendelés szükséges.` },
  { question: "Hogyan fizethetek, és kapok-e számlát?", answer: "A bankkártyás fizetés a Stripe Checkout felületén történik. A bankkártya adatait a Stripe kezeli. A szolgáltatás magánszemélyek számára érhető el; az elektronikus számla a megadott számlázási adatokkal készül. A szolgáltató alanyi adómentes." },
  { question: "Ez jogi tanácsadás?", answer: "Nem. A Levélsegéd kommunikációs segítséget ad a megadott tények megfogalmazásához. Nem vizsgálja szakértőként a jogi helyzetét, nem képviseli az ügyében, és nem garantálja a címzett válaszát vagy a kért eredményt. Jogi kérdésben kérjen szakembertől segítséget." },
  { question: "Mit tegyek, ha elveszett a rendelési link?", answer: "A Rendelési link oldalon kérheti a hozzáférési link újraküldését a rendeléséhez megadott e-mail-címre. A linket kezelje bizalmasan, mert hozzáférést adhat az elkészült levélhez. Ellenőrizze a levélszemét mappát is." },
];
export const pricingFaq = [
  { question: "Előfizetést vásárolok?", answer: Object.values(packages).some((item) => item.recurring) ? "Az egyes csomagok fizetési feltételei a csomagkártyán láthatók." : "Nem. A feltüntetett díj egyszeri fizetés egy levél elkészítéséért és a csomagban szereplő AI-módosításokért." },
  { question: "Kinek állítható ki számla?", answer: "A szolgáltatás magánszemély vásárlók számára érhető el. A számlázási adatokat fizetés előtt ellenőrizheti. A szolgáltató alanyi adómentes, a feltüntetett összeg a fizetendő végösszeg." },
  { question: "Mit jelent az AI-módosítás?", answer: "Az elkészült levél megfogalmazását a csomagban szereplő kereten belül módosíttathatja. A kézi szerkesztés nem fogyasztja ezt a keretet. A módosítás az eredeti ügyre vonatkozik, új ügyhöz új megrendelés szükséges." },
];
