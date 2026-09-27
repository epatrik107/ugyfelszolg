import { homeFaq, pricingFaq } from "../content/faq";
import { business } from "../config/business";
import { packages } from "../lib/constants";
import type { RouteSeo } from "./routes";
export function structuredData(route: RouteSeo, site: string): object[] {
  if (route.robots !== "index,follow") return [];
  const orgId = `${site}/#organization`;
  const data: object[] = [];
  if (["/", "/kapcsolat"].includes(route.path)) data.push({
    "@context": "https://schema.org", "@type": "Organization", "@id": orgId,
    name: business.brandName, legalName: business.legalName, url: `${site}/`,
    logo: `${site}/images/logo-512.png`, email: business.email, vatID: business.vatId,
    address: { "@type": "PostalAddress", ...business.address },
    contactPoint: { "@type": "ContactPoint", contactType: "customer support", email: business.email, availableLanguage: "hu" },
  });
  if (route.path === "/") data.push({
    "@context": "https://schema.org", "@type": "WebSite", "@id": `${site}/#website`,
    name: business.brandName, url: `${site}/`, inLanguage: "hu-HU", publisher: { "@id": orgId },
  });
  if (["/", "/arak"].includes(route.path)) data.push({
    "@context": "https://schema.org", "@type": "Service", name: "Hivatalos levél megírása", serviceType: "Online levélírás",
    provider: { "@id": orgId }, areaServed: "HU",
    availableChannel: { "@type": "ServiceChannel", serviceUrl: `${site}/level-keszites` },
    hasOfferCatalog: { "@type": "OfferCatalog", name: "Levélírás csomagok", itemListElement: Object.values(packages).map((item) => ({
      "@type": "Offer", name: item.name, price: item.numericPrice, priceCurrency: "HUF", url: `${site}/arak`,
      availability: "https://schema.org/InStock", itemOffered: { "@type": "Service", name: item.name },
    })) },
  });
  if (route.path !== "/") data.push({
    "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Főoldal", item: `${site}/` },
      { "@type": "ListItem", position: 2, name: route.title.split(" | ")[0], item: `${site}${route.path}` },
    ],
  });
  const faq = route.path === "/" ? homeFaq : route.path === "/arak" ? pricingFaq : [];
  if (faq.length) data.push({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map((item) => ({ "@type": "Question", name: item.question, acceptedAnswer: { "@type": "Answer", text: item.answer } })) });
  return data;
}
