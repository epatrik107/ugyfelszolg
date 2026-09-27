export const business = {
  brandName: "Levélsegéd",
  legalName: "Engelbrecht Zoltán egyéni vállalkozó",
  email: "ugyfelszolgalat2026@gmail.com",
  emailName: "Zoltán Engelbrecht",
  address: { streetAddress: "Bánomi út 4.", postalCode: "2500", addressLocality: "Esztergom", addressCountry: "HU" },
  vatId: "HU91250960", taxId: "91250960-1-31", registrationNumber: "60722263",
};
export const businessLegalText = `Szolgáltató neve: ${business.legalName}. Vállalkozás formája: egyéni vállalkozó. Székhelye: ${business.address.postalCode} ${business.address.addressLocality}, ${business.address.streetAddress} Adószáma: ${business.taxId}. Közösségi adószáma: ${business.vatId}. EV nyilvántartási száma: ${business.registrationNumber}. E-mail: ${business.emailName} <${business.email}>. Weboldal: levelseged.hu.`;
