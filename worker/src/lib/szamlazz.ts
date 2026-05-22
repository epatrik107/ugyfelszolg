import { PACKAGES } from "./packages";
import type { Env, OrderRow } from "./types";

const SZAMLAZZ_API_URL = "https://www.szamlazz.hu/szamla/";
const HUF_VAT_RATE = 0.27;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function calcHufAmounts(grossHUF: number): { net: number; vat: number; gross: number } {
  const net = Math.round((grossHUF / (1 + HUF_VAT_RATE)) * 100) / 100;
  const vat = Math.round((grossHUF - net) * 100) / 100;
  return { net, vat, gross: grossHUF };
}

function buildInvoiceXml(params: {
  agentKey: string;
  dateStr: string;
  customerName: string;
  customerEmail: string;
  serviceName: string;
  net: number;
  vat: number;
  gross: number;
  currency: string;
}): string {
  const { agentKey, dateStr, customerName, customerEmail, serviceName, net, vat, gross, currency } =
    params;

  return `<?xml version="1.0" encoding="UTF-8"?>
<xmlszamla xmlns="http://www.szamlazz.hu/xmlszamla" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.szamlazz.hu/xmlszamla http://www.szamlazz.hu/szamla/docs/xsd/agent/xmlszamla.xsd">
  <beallitasok>
    <szamlaagentkulcs>${escapeXml(agentKey)}</szamlaagentkulcs>
    <eszamla>true</eszamla>
    <szamlaszam/>
    <valaszVerzio>1</valaszVerzio>
    <szamlaLetoltes>false</szamlaLetoltes>
  </beallitasok>
  <fejlec>
    <keltDatum>${escapeXml(dateStr)}</keltDatum>
    <teljesitesDatum>${escapeXml(dateStr)}</teljesitesDatum>
    <fizetesiHataridoDatum>${escapeXml(dateStr)}</fizetesiHataridoDatum>
    <fizmod>Bankkártya</fizmod>
    <penznem>${escapeXml(currency.toUpperCase())}</penznem>
    <nyelv>hu</nyelv>
    <megjegyzes/>
    <fizetve>true</fizetve>
  </fejlec>
  <elado>
    <bank/>
    <bankszamlaszam/>
    <emailReplyto/>
    <emailTargy/>
    <emailSzoveg/>
  </elado>
  <vevo>
    <nev>${escapeXml(customerName)}</nev>
    <irsz/>
    <telepules/>
    <cim/>
    <email>${escapeXml(customerEmail)}</email>
    <sendEmail>false</sendEmail>
  </vevo>
  <tetelek>
    <tetel>
      <megnevezes>${escapeXml(serviceName)}</megnevezes>
      <mennyiseg>1</mennyiseg>
      <mennyisegiEgyseg>db</mennyisegiEgyseg>
      <nettoEgysegAr>${net}</nettoEgysegAr>
      <afakulcs>27</afakulcs>
      <nettoErtek>${net}</nettoErtek>
      <afaErtek>${vat}</afaErtek>
      <bruttoErtek>${gross}</bruttoErtek>
    </tetel>
  </tetelek>
</xmlszamla>`;
}

/**
 * Issues an invoice via szamlazz.hu and returns the invoice number assigned by szamlazz.hu.
 * Only called in production when SZAMLAZZ_AGENT_KEY is set.
 * Throws on API error – callers should catch and log without including the agent key.
 */
export async function issueSzamlazzInvoice(
  env: Env,
  order: Pick<
    OrderRow,
    "name" | "email" | "server_calculated_price" | "currency" | "paid_at" | "selected_package"
  >,
): Promise<string> {
  const agentKey = env.SZAMLAZZ_AGENT_KEY!;
  const issuedAt = order.paid_at ?? new Date().toISOString();
  const dateStr = issuedAt.slice(0, 10);
  const { net, vat, gross } = calcHufAmounts(order.server_calculated_price);
  const serviceName = PACKAGES[order.selected_package]?.name ?? "Levélírási szolgáltatás";

  const xml = buildInvoiceXml({
    agentKey,
    dateStr,
    customerName: order.name,
    customerEmail: order.email,
    serviceName,
    net,
    vat,
    gross,
    currency: order.currency,
  });

  const form = new FormData();
  form.append("action-szamla_agent_xml", xml);

  const response = await fetch(SZAMLAZZ_API_URL, { method: "POST", body: form });

  if (!response.ok) {
    throw new Error(`szamlazz.hu HTTP error: ${response.status}`);
  }

  const invoiceNumber = response.headers.get("szlaszam");
  if (invoiceNumber) {
    return invoiceNumber;
  }

  const errorCode = response.headers.get("szlahibakod") ?? "unknown";
  const errorMsg = response.headers.get("szlahiba") ?? "no details";
  throw new Error(`szamlazz.hu invoice rejected: [${errorCode}] ${errorMsg}`);
}
