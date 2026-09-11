import { afterEach, describe, expect, it, vi } from "vitest";
import { hasLetterEmailVersionSent } from "../src/lib/db";
import { EmailSendError, sendLetterReadyEmail } from "../src/lib/email";
import type { Env, OrderRow } from "../src/lib/types";

const legacyOrder = {
  // Predates per-version tracking: the flag says an email went out, but we
  // have no record of *which* letter it contained.
  letter_email_sent: 1,
  letter_email_sent_versions: null,
} as Pick<OrderRow, "letter_email_sent" | "letter_email_sent_versions">;

describe("hasLetterEmailVersionSent legacy fallback", () => {
  it("treats a legacy order as already sent when no specific version was asked for", () => {
    expect(hasLetterEmailVersionSent(legacyOrder, "sha256:aaa")).toBe(true);
  });

  it("does not swallow an explicit version request on a legacy order", () => {
    // Regression: this returned true, so the route answered {alreadySent:true}
    // and no email was ever sent for the version the customer picked.
    expect(hasLetterEmailVersionSent(legacyOrder, "sha256:aaa", false)).toBe(false);
  });

  it("still honours a recorded version hash regardless of the fallback flag", () => {
    const order = {
      letter_email_sent: 1,
      letter_email_sent_versions: JSON.stringify(["sha256:aaa"]),
    } as Pick<OrderRow, "letter_email_sent" | "letter_email_sent_versions">;
    expect(hasLetterEmailVersionSent(order, "sha256:aaa", false)).toBe(true);
    expect(hasLetterEmailVersionSent(order, "sha256:bbb", false)).toBe(false);
  });

  it("falls back safely when the stored version list is corrupt", () => {
    const order = {
      letter_email_sent: 1,
      letter_email_sent_versions: "{not json",
    } as Pick<OrderRow, "letter_email_sent" | "letter_email_sent_versions">;
    expect(hasLetterEmailVersionSent(order, "sha256:aaa")).toBe(true);
    expect(hasLetterEmailVersionSent(order, "sha256:aaa", false)).toBe(false);
  });
});

describe("email provider failures carry the HTTP status", () => {
  const env = {
    RESEND_API_KEY: "re_test",
    EMAIL_FROM: "Levélsegéd <noreply@levelseged.hu>",
    SITE_URL: "https://levelseged.hu",
    SELLER_NAME: "Teszt",
    SELLER_ADDRESS: "Teszt",
  } as unknown as Env;

  const order = {
    id: "order_1",
    email: "vasarlo@example.com",
    name: "Teszt Elek",
    public_id: "public_1",
    generation_count: 1,
  } as Pick<OrderRow, "id" | "email" | "name" | "public_id" | "generation_count">;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("surfaces a 401 as EmailSendError with the status attached", async () => {
    // A domain-scoped API key whose domain was removed fails exactly like this,
    // and the request never shows up in the provider's own account log.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));

    const error = await sendLetterReadyEmail(env, order, "Levél", "token").catch(
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(EmailSendError);
    expect((error as EmailSendError).status).toBe(401);
    expect((error as EmailSendError).name).toBe("EmailSendError");
  });

  it("never puts the provider response body into the error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: "vasarlo@example.com is blocked" }), {
            status: 422,
          }),
      ),
    );

    const error = (await sendLetterReadyEmail(env, order, "Levél", "token").catch(
      (err: unknown) => err,
    )) as EmailSendError;

    expect(error.status).toBe(422);
    expect(error.message).not.toContain("vasarlo@example.com");
  });

  it("reports a missing configuration without a status", async () => {
    const error = (await sendLetterReadyEmail(
      { ...env, RESEND_API_KEY: "" } as unknown as Env,
      order,
      "Levél",
      "token",
    ).catch((err: unknown) => err)) as EmailSendError;

    expect(error).toBeInstanceOf(EmailSendError);
    expect(error.status).toBeNull();
  });
});
