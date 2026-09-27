import legalVersions from "../config/legalVersions.json";
export type RouteSeo = {
  path: string; title: string; description: string;
  robots: "index,follow" | "noindex,follow" | "noindex,nofollow";
  render: "prerender" | "shell";
  lastmod?: string;
};
const page = (path: string, title: string, description: string, lastmod = "2026-09-27"): RouteSeo => ({
  path, title: `${title} | Levélsegéd`, description, robots: "index,follow", render: "prerender", lastmod,
});
const shell = (path: string, title: string, description: string, follow = false): RouteSeo => ({
  path, title: `${title} | Levélsegéd`, description, robots: follow ? "noindex,follow" : "noindex,nofollow", render: "shell",
});
export const seoRoutes: RouteSeo[] = [
  page("/", "Hivatalos levél írása online", "Írja le problémáját, és AI segítségével elkészítjük hivatalos, udvarias és határozott levelét. Panaszlevél, reklamáció, felszólítás 890 Ft-tól."),
  page("/level-keszites", "Levél készítése online 3 lépésben", "Töltse ki a rövid űrlapot 3–5 perc alatt, ellenőrizze az összegzést, és fizessen biztonságosan. A kész levelet átnézheti és szerkesztheti."),
  page("/arak", "Árak – levélírás 890 Ft-tól", "Alapcsomag 890 Ft, Prémium 2 990 Ft, Prémium plusz 3 990 Ft. Egyszeri díj, elektronikus számlával. Hasonlítsa össze a csomagokat."),
  page("/kapcsolat", "Kapcsolat", "Kérdése van a rendelésével vagy a szolgáltatással kapcsolatban? Írjon nekünk az űrlapon vagy e-mailben."),
  page("/aszf", "Általános Szerződési Feltételek", `A Levélsegéd szolgáltatásának feltételei: megrendelés, fizetés, teljesítés és panaszkezelés. Verzió: ${legalVersions.terms.version}.`, legalVersions.terms.effectiveDate),
  page("/adatkezeles", "Adatkezelési tájékoztató", `A Levélsegéd adatkezelési tájékoztatója: kezelt adatok, megőrzés és érintetti jogok. Verzió: ${legalVersions.privacy.version}.`, legalVersions.privacy.effectiveDate),
  shell("/sikeres-fizetes", "Rendelés állapota", "A fizetés és a megrendelt levél állapota."),
  shell("/sikertelen-fizetes", "Megszakadt fizetés", "Tájékoztatás a megszakadt fizetésről és a folytatás lehetőségeiről."),
  shell("/rendeles-link", "Rendelési link újraküldése", "Kérje újra a rendeléséhez tartozó hozzáférési linket e-mailben.", true),
];
export const notFoundSeo = shell("/404.html", "Az oldal nem található", "A keresett oldal nem található. Látogasson el a főoldalra, vagy kezdje el levele elkészítését.");
export function routeForPath(pathname: string) {
  const path = pathname === "/index.html" ? "/" : pathname.replace(/\/$/, "") || "/";
  return seoRoutes.find((route) => route.path === path) ?? notFoundSeo;
}
