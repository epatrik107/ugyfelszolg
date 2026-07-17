import { describe, expect, it } from "vitest";
import {
  REQUIRED_FRONTEND_VARIABLES,
  REQUIRED_WORKER_SECRETS,
  REQUIRED_WORKER_VARIABLES,
  auditEnvironment,
  auditPassed,
  auditRepository,
} from "../../scripts/audit-github-config.mjs";

describe("GitHub environment name-only audit", () => {
  it("accepts an exact production environment without repository-level shadowing", () => {
    const result = auditEnvironment({
      environment: "production",
      secrets: REQUIRED_WORKER_SECRETS,
      variables: [...REQUIRED_WORKER_VARIABLES, ...REQUIRED_FRONTEND_VARIABLES],
    });

    expect(auditPassed(result)).toBe(true);
  });

  it("reports missing, stale, forbidden, and shadowed production names", () => {
    const result = auditEnvironment({
      environment: "production",
      secrets: ["ADMIN_API_TOKEN", "GEMINI_API_KEY"],
      variables: ["SITE_URL", "STALE_VARIABLE"],
      repositorySecrets: ["GEMINI_API_KEY"],
      repositoryVariables: ["SITE_URL"],
    });

    expect(result.missingSecrets).toContain("STRIPE_SECRET_KEY");
    expect(result.unexpectedSecrets).toContain("ADMIN_API_TOKEN");
    expect(result.unexpectedVariables).toEqual(["STALE_VARIABLE"]);
    expect(result.repositorySecretDuplicates).toEqual(["GEMINI_API_KEY"]);
    expect(result.repositoryVariableDuplicates).toEqual(["SITE_URL"]);
    expect(result.forbiddenProductionSecrets).toEqual(["ADMIN_API_TOKEN"]);
    expect(auditPassed(result)).toBe(false);
  });

  it("allows the sandbox-only admin token but not a demo access code", () => {
    const result = auditEnvironment({
      environment: "sandbox",
      secrets: [...REQUIRED_WORKER_SECRETS, "ADMIN_API_TOKEN", "DEMO_ACCESS_CODE"],
      variables: REQUIRED_WORKER_VARIABLES,
    });

    expect(result.unexpectedSecrets).toEqual(["DEMO_ACCESS_CODE"]);
  });

  it("rejects repository-scoped application configuration", () => {
    const result = auditRepository({
      secrets: ["GEMINI_API_KEY"],
      variables: ["CLOUDFLARE_D1_DATABASE_ID"],
    });

    expect(result.unexpectedSecrets).toEqual(["GEMINI_API_KEY"]);
    expect(result.unexpectedVariables).toEqual(["CLOUDFLARE_D1_DATABASE_ID"]);
    expect(auditPassed(result)).toBe(false);
  });
});
