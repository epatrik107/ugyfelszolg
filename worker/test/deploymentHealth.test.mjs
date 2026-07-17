import { describe, expect, it, vi } from "vitest";
import { checkDeploymentHealth } from "../../scripts/check-deployment-health.mjs";

const secureHeaders = {
  "Content-Security-Policy": "default-src 'none'",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=63072000",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Content-Type": "application/json",
};

describe("deployment health gate", () => {
  it("accepts only an ok health response with security headers", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: secureHeaders,
      }),
    );

    await expect(
      checkDeploymentHealth({
        healthUrl: "https://api.example.com/api/health",
        fetchImpl,
        attempts: 1,
      }),
    ).resolves.toEqual({ ok: true, attempt: 1 });
  });

  it("rejects degraded responses and missing headers", async () => {
    const degraded = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "degraded" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      checkDeploymentHealth({
        healthUrl: "https://api.example.com/api/health",
        fetchImpl: degraded,
        attempts: 1,
      }),
    ).rejects.toThrow("Deployment health check failed");
  });

  it("rejects non-HTTPS remote health URLs", async () => {
    await expect(
      checkDeploymentHealth({
        healthUrl: "http://api.example.com/api/health",
        attempts: 1,
      }),
    ).rejects.toThrow("must use HTTPS");
  });

  it("rejects credentials, query strings, and fragments in the health URL", async () => {
    for (const healthUrl of [
      "https://user:password@api.example.com/api/health",
      "https://api.example.com/api/health?token=secret",
      "https://api.example.com/api/health#fragment",
    ]) {
      await expect(
        checkDeploymentHealth({ healthUrl, attempts: 1 }),
      ).rejects.toThrow("must not contain");
    }
  });
});
