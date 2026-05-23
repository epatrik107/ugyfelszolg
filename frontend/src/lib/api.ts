import { API_BASE_URL } from "./config";
import type { BusinessSession, LetterFormValues, OrderResult } from "./types";

type ApiSuccess<T> = { ok: true; data: T };
type ApiError = { ok: false; error: { code: string; message: string } };
type ApiResponse<T> = ApiSuccess<T> | ApiError;

async function request<T>(
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new Error(
      "Nem sikerült elérni a szervert. Kérjük, frissítse az oldalt, majd próbálja újra.",
    );
  }

  const payload = (await response.json().catch(() => null)) as ApiResponse<T> | null;
  if (!response.ok) {
    const errMsg =
      (payload as ApiError | null)?.error?.message || "Ismeretlen hiba.";
    throw new Error(errMsg);
  }
  return ((payload as ApiSuccess<T> | null)?.data ?? payload) as T;
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

export function requestRegeneration(publicId: string, token: string, feedback: string) {
  return request<Record<string, never>>(
    `/api/orders/${publicId}/regenerate`,
    {
      method: "POST",
      body: JSON.stringify({ feedback }),
    },
    token,
  );
}

export function sendLetterByEmail(publicId: string, token: string, versionIndex?: number) {
  return request<Record<string, never>>(
    `/api/orders/${publicId}/send-letter`,
    {
      method: "POST",
      body: JSON.stringify(versionIndex !== undefined ? { versionIndex } : {}),
    },
    token,
  );
}

export function sendContactMessage(values: {
  name: string;
  email: string;
  message: string;
  turnstileToken: string;
}) {
  return request<Record<string, never>>("/api/contact", {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function requestBusinessAccessLink(values: {
  email: string;
  turnstileToken: string;
}) {
  return request<Record<string, never>>("/api/business/access-link", {
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
