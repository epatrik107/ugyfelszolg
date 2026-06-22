import { calculateHufB2cVat } from "./billing";
import { PACKAGES } from "./packages";
import type { Env, OrderRow } from "./types";

const SZAMLAZZ_API_URL = "https://www.szamlazz.hu/szamla/";

export class InvoiceProviderError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    message = "A számlaszolgáltató elutasította a kérést.",
  ) {
    super(message);
    this.name = "InvoiceProviderError";
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeHeader(value: string | null) {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export interface SzamlazzInvoicePayload {
  externalId: string;
  issueDate: string;
  performanceDate: string;
  customerName: string;
  customerEmail: string;
  country: "HU";
  postalCode: string;
  city: string;
  addressLine1: string;
  serviceName: string;
  quantity: 1;
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
  vatRate: 27;
  currency: "HUF";
}

export function buildSzamlazzPayload(
  order: Pick<
    OrderRow,
    | "id"
    | "billing_name"
    | "billing_email"
    | "billing_country"
    | "billing_postal_code"
    | "billing_city"
    | "billing_address_line1"
    | "server_calculated_price"
    | "currency"
    | "paid_at"
    | "selected_package"
  >,
): SzamlazzInvoicePayload {
  if (
    !order.billing_name ||
    !order.billing_email ||
    order.billing_country !== "HU" ||
    !order.billing_postal_code ||
    !order.billing_city ||
    !order.billing_address_line1
  ) {
    throw new InvoiceProviderError("INVALID_BILLING_DATA", false, "Hiányos számlázási adatok.");
  }
  if (order.currency.toLowerCase() !== "huf") {
    throw new InvoiceProviderError("UNSUPPORTED_CURRENCY", false, "Nem támogatott pénznem.");
  }

  const amounts = calculateHufB2cVat(order.server_calculated_price, 27);
  return {
    externalId: order.id,
    issueDate: new Date().toISOString().slice(0, 10),
    performanceDate: (order.paid_at ?? new Date().toISOString()).slice(0, 10),
    customerName: order.billing_name,
    customerEmail: order.billing_email,
    country: "HU",
    postalCode: order.billing_postal_code,
    city: order.billing_city,
    addressLine1: order.billing_address_line1,
    serviceName: PACKAGES[order.selected_package]?.name ?? "Levélírási szolgáltatás",
    quantity: 1,
    netAmount: amounts.netAmount,
    vatAmount: amounts.vatAmount,
    grossAmount: amounts.grossAmount,
    vatRate: 27,
    currency: "HUF",
  };
}

export function buildInvoiceXml(
  agentKey: string,
  invoice: SzamlazzInvoicePayload,
  sendEmail = true,
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<xmlszamla xmlns="http://www.szamlazz.hu/xmlszamla" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.szamlazz.hu/xmlszamla https://www.szamlazz.hu/szamla/docs/xsds/agent/xmlszamla.xsd">
  <beallitasok>
    <szamlaagentkulcs>${escapeXml(agentKey)}</szamlaagentkulcs>
    <eszamla>true</eszamla>
    <szamlaLetoltes>false</szamlaLetoltes>
    <valaszVerzio>1</valaszVerzio>
    <aggregator></aggregator>
    <szamlaKulsoAzon>${escapeXml(invoice.externalId)}</szamlaKulsoAzon>
  </beallitasok>
  <fejlec>
    <keltDatum>${invoice.issueDate}</keltDatum>
    <teljesitesDatum>${invoice.performanceDate}</teljesitesDatum>
    <fizetesiHataridoDatum>${invoice.performanceDate}</fizetesiHataridoDatum>
    <fizmod>Bankkártya</fizmod>
    <penznem>${invoice.currency}</penznem>
    <szamlaNyelve>hu</szamlaNyelve>
    <megjegyzes></megjegyzes>
    <rendelesSzam>${escapeXml(invoice.externalId)}</rendelesSzam>
    <fizetve>true</fizetve>
  </fejlec>
  <elado>
    <bank></bank>
    <bankszamlaszam></bankszamlaszam>
    <emailReplyto></emailReplyto>
    <emailTargy></emailTargy>
    <emailSzoveg></emailSzoveg>
  </elado>
  <vevo>
    <nev>${escapeXml(invoice.customerName)}</nev>
    <orszag>${invoice.country}</orszag>
    <irsz>${escapeXml(invoice.postalCode)}</irsz>
    <telepules>${escapeXml(invoice.city)}</telepules>
    <cim>${escapeXml(invoice.addressLine1)}</cim>
    <email>${escapeXml(invoice.customerEmail)}</email>
    <sendEmail>${sendEmail}</sendEmail>
    <adoalany>-1</adoalany>
  </vevo>
  <tetelek>
    <tetel>
      <megnevezes>${escapeXml(invoice.serviceName)}</megnevezes>
      <mennyiseg>${invoice.quantity}</mennyiseg>
      <mennyisegiEgyseg>db</mennyisegiEgyseg>
      <nettoEgysegar>${invoice.netAmount}</nettoEgysegar>
      <afakulcs>${invoice.vatRate}</afakulcs>
      <nettoErtek>${invoice.netAmount}</nettoErtek>
      <afaErtek>${invoice.vatAmount}</afaErtek>
      <bruttoErtek>${invoice.grossAmount}</bruttoErtek>
    </tetel>
  </tetelek>
</xmlszamla>`;
}

function buildInvoiceQueryXml(agentKey: string, externalId: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<xmlszamlaxml xmlns="http://www.szamlazz.hu/xmlszamlaxml" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.szamlazz.hu/xmlszamlaxml https://www.szamlazz.hu/szamla/docs/xsds/agentxml/xmlszamlaxml.xsd">
  <szamlaagentkulcs>${escapeXml(agentKey)}</szamlaagentkulcs>
  <szamlaszam></szamlaszam>
  <rendelesSzam></rendelesSzam>
  <pdf>false</pdf>
  <szamlaKulsoAzon>${escapeXml(externalId)}</szamlaKulsoAzon>
</xmlszamlaxml>`;
}

function formWithXml(field: string, xml: string, filename: string) {
  const form = new FormData();
  form.append(field, new Blob([xml], { type: "application/xml" }), filename);
  return form;
}

function providerErrorFromResponse(response: Response) {
  const code = response.headers.get("szlahu_error_code") ?? `HTTP_${response.status}`;
  const retryable = response.status === 408 || response.status === 429 || response.status >= 500 || code === "1" || code === "55";
  return new InvoiceProviderError(code, retryable);
}

async function fetchSzamlazz(form: FormData) {
  try {
    return await fetch(SZAMLAZZ_API_URL, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const code = error instanceof DOMException && error.name === "TimeoutError" ? "TIMEOUT" : "NETWORK_ERROR";
    throw new InvoiceProviderError(code, true, "A számlaszolgáltató átmenetileg nem érhető el.");
  }
}

export interface SzamlazzResult {
  invoiceNumber: string;
  externalId: string;
  pdfUrl: string | null;
  alreadyExisted: boolean;
}

export async function findSzamlazzInvoice(
  env: Env,
  externalId: string,
): Promise<SzamlazzResult | null> {
  if (!env.SZAMLAZZ_AGENT_KEY) {
    throw new InvoiceProviderError("NOT_CONFIGURED", false);
  }
  const response = await fetchSzamlazz(
    formWithXml(
      "action-szamla_agent_xml",
      buildInvoiceQueryXml(env.SZAMLAZZ_AGENT_KEY, externalId),
      "invoice-query.xml",
    ),
  );
  const errorCode = response.headers.get("szlahu_error_code");
  if (errorCode === "7") return null;
  if (!response.ok || errorCode) throw providerErrorFromResponse(response);

  const body = await response.text();
  const headerNumber = decodeHeader(response.headers.get("szlahu_szamlaszam"));
  const xmlNumber = body.match(/<szamlaszam>([^<]+)<\/szamlaszam>/u)?.[1] ?? null;
  const invoiceNumber = headerNumber ?? xmlNumber;
  if (!invoiceNumber) return null;
  const headerUrl = decodeHeader(response.headers.get("szlahu_vevoifiokurl"));
  const xmlUrl = body.match(/<vevoifiokurl>([^<]+)<\/vevoifiokurl>/u)?.[1] ?? null;
  return {
    invoiceNumber,
    externalId,
    pdfUrl: headerUrl ?? xmlUrl,
    alreadyExisted: true,
  };
}

export async function issueSzamlazzInvoice(
  env: Env,
  invoice: SzamlazzInvoicePayload,
  reconcileFirst = false,
): Promise<SzamlazzResult> {
  if (!env.SZAMLAZZ_AGENT_KEY) {
    throw new InvoiceProviderError("NOT_CONFIGURED", false);
  }
  if (reconcileFirst) {
    const existing = await findSzamlazzInvoice(env, invoice.externalId);
    if (existing) return existing;
  }

  const response = await fetchSzamlazz(
    formWithXml(
      "action-xmlagentxmlfile",
      buildInvoiceXml(
        env.SZAMLAZZ_AGENT_KEY,
        invoice,
        env.PAYMENT_MODE !== "test",
      ),
      "invoice.xml",
    ),
  );
  const errorCode = response.headers.get("szlahu_error_code");
  if (!response.ok || errorCode) throw providerErrorFromResponse(response);

  const body = await response.text();
  const headerNumber = decodeHeader(response.headers.get("szlahu_szamlaszam"));
  const textNumber = body.startsWith("xmlagentresponse=DONE;")
    ? body.slice("xmlagentresponse=DONE;".length).trim()
    : null;
  const invoiceNumber = headerNumber ?? textNumber;
  if (!invoiceNumber) {
    throw new InvoiceProviderError("INVALID_RESPONSE", true, "A számlaszolgáltató válasza hiányos.");
  }
  return {
    invoiceNumber,
    externalId: invoice.externalId,
    pdfUrl: decodeHeader(response.headers.get("szlahu_vevoifiokurl")),
    alreadyExisted: false,
  };
}
