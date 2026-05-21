import type { Env, SubscriptionRow } from "./types";

export async function sendBusinessMagicLink(
  env: Env,
  subscription: SubscriptionRow,
  token: string,
) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    throw new Error("Email service is not configured.");
  }

  const link = `${env.SITE_URL}/ceges?magic=${token}`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `magic-${subscription.id}-${token.slice(0, 12)}`,
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [subscription.email],
      subject: "Ügyfélközpont céges hozzáférés",
      text: `A céges Ügyfélközpont hozzáféréséhez nyissa meg ezt a linket:\n\n${link}\n\nA link 30 percig érvényes.`,
    }),
  });

  if (!response.ok) {
    throw new Error(`Resend API error (${response.status})`);
  }
}
