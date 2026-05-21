import { API_BASE_URL } from "./config";
import type { BusinessSession, LetterFormValues, OrderResult } from "./types";

async function request<T>(
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  const payload = (await response.json().catch(() => null)) as
    | T
    | { error?: string }
    | null;
  if (!response.ok) {
    throw new Error((payload as { error?: string } | null)?.error || "Ismeretlen hiba.");
  }
  return payload as T;
}

export function createCheckoutSession(values: LetterFormValues) {
  return request<{ checkoutUrl: string; publicId: string }>(
    "/api/create-checkout-session",
    {
      method: "POST",
      body: JSON.stringify(values),
    },
  );
}

export function getOrderResult(publicId: string, token: string) {
  return request<OrderResult>(`/api/orders/${publicId}/result`, {}, token);
}

export function sendContactMessage(values: {
  name: string;
  email: string;
  message: string;
  turnstileToken: string;
}) {
  return request<{ ok: true }>("/api/contact", {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function requestBusinessAccessLink(values: {
  email: string;
  turnstileToken: string;
}) {
  return request<{ ok: true }>("/api/business/access-link", {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function exchangeBusinessMagicLink(token: string) {
  return request<{ sessionToken: string }>("/api/business/session/exchange", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export function getBusinessSession(sessionToken: string) {
  return request<BusinessSession>("/api/business/session", {}, sessionToken);
}

export function createBusinessOrder(
  values: Omit<LetterFormValues, "selectedPackage" | "turnstileToken">,
  sessionToken: string,
) {
  return request<{ publicId: string; resultToken: string }>(
    "/api/business/orders",
    {
      method: "POST",
      body: JSON.stringify(values),
    },
    sessionToken,
  );
}

export function createBusinessPortalSession(sessionToken: string) {
  return request<{ url: string }>(
    "/api/business/customer-portal-session",
    { method: "POST" },
    sessionToken,
  );
}
