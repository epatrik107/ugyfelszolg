/**
 * Shared HTML email templates.
 * All currency amounts are stored as integer HUF forints.
 */

function formatAmount(amount: number, currency: string): string {
  const locale = currency.toLowerCase() === "huf" ? "hu-HU" : "en-US";
  const curr = currency.toUpperCase();
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: curr,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("hu-HU", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function baseHtml(title: string, body: string, sellerName: string, sellerAddress: string): string {
  return `<!DOCTYPE html>
<html lang="hu">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;color:#10233f;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:#10233f;padding:24px 32px;">
              <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">Ügyfélközpont</p>
              <p style="margin:4px 0 0;font-size:13px;color:#94a3b8;">Hivatalos levélírási asszisztens</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              ${body}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:24px 32px;border-top:1px solid #e2e8f0;background:#f8fafc;">
              <p style="margin:0;font-size:12px;color:#64748b;line-height:1.6;">
                <strong>${sellerName}</strong><br>
                ${sellerAddress}<br>
                Ez az email automatikusan generált értesítés.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export interface InvoiceEmailData {
  invoiceNumber: string;
  issuedAt: string;
  customerName: string;
  customerEmail: string;
  serviceName: string;
  amount: number;
  currency: string;
  sellerName: string;
  sellerAddress: string;
  sellerTaxNumber: string;
}

export function invoiceEmailHtml(data: InvoiceEmailData): string {
  const body = `
    <h2 style="margin:0 0 4px;font-size:22px;font-weight:700;color:#10233f;">Számla</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#64748b;">Köszönjük a megrendelést!</p>

    <!-- Invoice meta -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr>
        <td style="padding:0 16px 0 0;vertical-align:top;width:50%;">
          <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Számlaszám</p>
          <p style="margin:0;font-size:15px;font-weight:700;color:#10233f;">${data.invoiceNumber}</p>
        </td>
        <td style="vertical-align:top;width:50%;">
          <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Kiállítás dátuma</p>
          <p style="margin:0;font-size:15px;color:#10233f;">${formatDate(data.issuedAt)}</p>
        </td>
      </tr>
    </table>

    <!-- Parties -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;">
      <tr style="background:#f8fafc;">
        <td style="padding:12px 16px;width:50%;vertical-align:top;border-right:1px solid #e2e8f0;">
          <p style="margin:0 0 6px;font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Eladó</p>
          <p style="margin:0;font-size:13px;color:#10233f;line-height:1.6;">
            <strong>${data.sellerName}</strong><br>
            ${data.sellerAddress}<br>
            Adószám: ${data.sellerTaxNumber}
          </p>
        </td>
        <td style="padding:12px 16px;width:50%;vertical-align:top;">
          <p style="margin:0 0 6px;font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Vevő</p>
          <p style="margin:0;font-size:13px;color:#10233f;line-height:1.6;">
            <strong>${data.customerName}</strong><br>
            ${data.customerEmail}
          </p>
        </td>
      </tr>
    </table>

    <!-- Line items -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;">
      <thead>
        <tr style="background:#f8fafc;">
          <th style="padding:10px 16px;text-align:left;font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Megnevezés</th>
          <th style="padding:10px 16px;text-align:right;font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Összeg</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="padding:12px 16px;font-size:14px;color:#10233f;border-top:1px solid #e2e8f0;">
            ${data.serviceName}
          </td>
          <td style="padding:12px 16px;font-size:14px;color:#10233f;text-align:right;border-top:1px solid #e2e8f0;">
            ${formatAmount(data.amount, data.currency)}
          </td>
        </tr>
      </tbody>
      <tfoot>
        <tr style="background:#f8fafc;border-top:2px solid #e2e8f0;">
          <td style="padding:12px 16px;font-size:14px;font-weight:700;color:#10233f;">Fizetendő összeg</td>
          <td style="padding:12px 16px;font-size:16px;font-weight:700;color:#10233f;text-align:right;">${formatAmount(data.amount, data.currency)}</td>
        </tr>
      </tfoot>
    </table>
    <p style="margin:0 0 24px;font-size:12px;color:#64748b;">Fizetési mód: Bankkártyás fizetés (Stripe) &mdash; Teljesítés dátuma: ${formatDate(data.issuedAt)}</p>

    <p style="margin:0;font-size:13px;color:#64748b;line-height:1.6;">
      A generált levél a fizetés visszaigazolásával egyidejűleg elérhető a rendelési oldalon.<br>
      Amennyiben kérdése van, kérjük, vegye fel velünk a kapcsolatot.
    </p>
  `;
  return baseHtml(`Számla – ${data.invoiceNumber}`, body, data.sellerName, data.sellerAddress);
}

export interface RefundEmailData {
  customerName: string;
  invoiceNumber: string | null;
  amount: number;
  currency: string;
  reason: string;
  siteUrl: string;
  sellerName: string;
  sellerAddress: string;
}

export function refundEmailHtml(data: RefundEmailData): string {
  const body = `
    <h2 style="margin:0 0 4px;font-size:22px;font-weight:700;color:#10233f;">Visszatérítési értesítő</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#64748b;">Sajnáljuk a kellemetlenséget!</p>

    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:16px 20px;margin-bottom:24px;">
      <p style="margin:0;font-size:14px;color:#991b1b;line-height:1.6;">
        A(z) <strong>${data.invoiceNumber ?? "rendelése"}</strong> összege —
        <strong>${formatAmount(data.amount, data.currency)}</strong> —
        visszatérítésre kerül az Ön bankkártyájára.<br>
        A visszatérítés általában <strong>5–10 munkanapon</strong> belül jelenik meg a kártyakivonaton.
      </p>
    </div>

    <p style="margin:0 0 8px;font-size:14px;color:#334155;line-height:1.6;"><strong>Mi történt?</strong></p>
    <p style="margin:0 0 24px;font-size:14px;color:#64748b;line-height:1.6;">${data.reason}</p>

    <p style="margin:0 0 16px;font-size:14px;color:#334155;line-height:1.6;">
      Kérjük, próbálja újra — a rendszer rendszerint néhány percen belül visszaáll a normál működésre.
    </p>

    <a href="${data.siteUrl}/level-keszites" style="display:inline-block;padding:12px 24px;background:#10233f;color:#ffffff;border-radius:6px;font-size:14px;font-weight:600;text-decoration:none;">Újra megrendelem</a>
  `;
  return baseHtml("Visszatérítési értesítő", body, data.sellerName, data.sellerAddress);
}

export interface PaymentFailedEmailData {
  customerName: string;
  amount: number;
  currency: string;
  siteUrl: string;
  sellerName: string;
  sellerAddress: string;
}

export function paymentFailedEmailHtml(data: PaymentFailedEmailData): string {
  const body = `
    <h2 style="margin:0 0 4px;font-size:22px;font-weight:700;color:#10233f;">A fizetés nem sikerült</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#64748b;">Kedves ${data.customerName},</p>

    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:16px 20px;margin-bottom:24px;">
      <p style="margin:0;font-size:14px;color:#92400e;line-height:1.6;">
        A(z) <strong>${formatAmount(data.amount, data.currency)}</strong> összegű fizetés feldolgozása sikertelen volt.
        Levele nem készült el, és <strong>semmilyen összeg nem lett levonva</strong> a számlájáról.
      </p>
    </div>

    <p style="margin:0 0 8px;font-size:14px;color:#334155;line-height:1.6;"><strong>Lehetséges okok:</strong></p>
    <ul style="margin:0 0 24px;padding-left:20px;font-size:14px;color:#64748b;line-height:1.8;">
      <li>Nincs elegendő fedezet a kártyán</li>
      <li>A kártyakibocsátó elutasította a tranzakciót</li>
      <li>Helytelen kártyaadatok kerültek megadásra</li>
      <li>Időszakos banki hiba</li>
    </ul>

    <p style="margin:0 0 16px;font-size:14px;color:#334155;line-height:1.6;">
      Kérjük, próbálja újra egy másik kártyával, vagy néhány perc múlva.
    </p>

    <a href="${data.siteUrl}/level-keszites" style="display:inline-block;padding:12px 24px;background:#10233f;color:#ffffff;border-radius:6px;font-size:14px;font-weight:600;text-decoration:none;">Újrapróbálom</a>
  `;
  return baseHtml("A fizetés nem sikerült", body, data.sellerName, data.sellerAddress);
}

export interface BusinessMagicLinkEmailData {
  magicLink: string;
  sellerName: string;
  sellerAddress: string;
}

export function businessMagicLinkEmailHtml(data: BusinessMagicLinkEmailData): string {
  const body = `
    <h2 style="margin:0 0 4px;font-size:22px;font-weight:700;color:#10233f;">Céges hozzáférés</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#64748b;">Kattintson az alábbi gombra a céges Ügyfélközpont felület megnyitásához.</p>

    <div style="text-align:center;margin:32px 0;">
      <a href="${data.magicLink}" style="display:inline-block;padding:14px 32px;background:#10233f;color:#ffffff;border-radius:6px;font-size:15px;font-weight:700;text-decoration:none;">
        Bejelentkezés a céges felületre
      </a>
    </div>

    <p style="margin:0 0 8px;font-size:13px;color:#64748b;line-height:1.6;">
      A link <strong>30 percig érvényes</strong>. Ha lejárt, kérhet újat a céges bejelentkezési oldalon.
    </p>
    <p style="margin:0;font-size:12px;color:#94a3b8;">
      Ha nem Ön kérte ezt az emailt, hagyja figyelmen kívül.
    </p>
  `;
  return baseHtml("Céges hozzáférési link", body, data.sellerName, data.sellerAddress);
}
