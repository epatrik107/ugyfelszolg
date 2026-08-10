import { describe, expect, it } from "vitest";
import { validateWorkerDeployConfig } from "../../scripts/worker-deploy-preflight.mjs";

const validProductionConfig = `
name = "ugyfelkozpont-api"
main = "src/index.ts"
compatibility_date = "2026-05-18"
workers_dev = false

[[d1_databases]]
binding = "DB"
database_name = "ugyfelkozpont"
database_id = "da3cbef7-ebe2-4bdd-ac7e-0c3f3e9b1585"
migrations_dir = "migrations"

[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "330e31489f97415989d94972003b0202"

[vars]
SITE_URL = "https://xn--gyfelszolgalat-fsb.hu"
ALLOWED_ORIGINS = "https://xn--gyfelszolgalat-fsb.hu,https://epatrik107.github.io"
TURNSTILE_EXPECTED_HOSTNAMES = "xn--gyfelszolgalat-fsb.hu"
LEGAL_TERMS_VERSION = "2026-07-14"
PRIVACY_POLICY_VERSION = "2026-07-14"
ADMIN_API_ENABLED = "false"
EMAIL_FROM = "Ügyfélszolgálat.hu <noreply@xn--gyfelszolgalat-fsb.hu>"
DEMO_MODE = "false"
PAYMENTS_ENABLED = "true"
PAYMENT_MODE = "live"
SZAMLAZZ_TEST_ACCOUNT_CONFIRMED = "false"
SELLER_NAME = "Engelbrecht Zoltán egyéni vállalkozó"
SELLER_ADDRESS = "2500 Esztergom, Bánomi út 4."
SELLER_TAX_NUMBER = "91250960-1-31"
`;

function replaceConfig(source, from, to) {
  return source.replace(from, to);
}

describe("worker deploy preflight", () => {
  it("requires an explicit deploy target", () => {
    const result = validateWorkerDeployConfig(validProductionConfig, "");

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "Set WORKER_DEPLOY_TARGET to sandbox or production before deploying.",
    );
  });

  it("accepts a production-safe worker config", () => {
    const result = validateWorkerDeployConfig(validProductionConfig, "production");

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("blocks localhost and test payment mode in production", () => {
    const unsafe = replaceConfig(
      replaceConfig(validProductionConfig, 'SITE_URL = "https://xn--gyfelszolgalat-fsb.hu"', 'SITE_URL = "http://localhost:5173"'),
      'PAYMENT_MODE = "live"',
      'PAYMENT_MODE = "test"',
    );

    const result = validateWorkerDeployConfig(unsafe, "production");

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("Production deploy requires PAYMENT_MODE=live.");
    expect(result.errors).toContain("Production SITE_URL and ALLOWED_ORIGINS must be HTTPS URLs.");
    expect(result.errors).toContain("Production deploy cannot use localhost URLs.");
  });

  it("blocks placeholder seller data in production", () => {
    const unsafe = replaceConfig(
      replaceConfig(
        replaceConfig(validProductionConfig, 'SELLER_NAME = "Engelbrecht Zoltán egyéni vállalkozó"', 'SELLER_NAME = "Test"'),
        'SELLER_ADDRESS = "2500 Esztergom, Bánomi út 4."',
        'SELLER_ADDRESS = "Test"',
      ),
      'SELLER_TAX_NUMBER = "91250960-1-31"',
      'SELLER_TAX_NUMBER = "00000XXXXXX"',
    );

    const result = validateWorkerDeployConfig(unsafe, "production");

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("Production SELLER_NAME must be set to the legal seller name.");
    expect(result.errors).toContain("Production SELLER_ADDRESS must be set to the legal seller address.");
    expect(result.errors).toContain("Production SELLER_TAX_NUMBER must be set to the legal seller tax number.");
  });

  it("blocks an email sender outside the verified production domain", () => {
    const unsafe = replaceConfig(
      validProductionConfig,
      'EMAIL_FROM = "Ügyfélszolgálat.hu <noreply@xn--gyfelszolgalat-fsb.hu>"',
      'EMAIL_FROM = "Service <sender@gmail.com>"',
    );

    const result = validateWorkerDeployConfig(unsafe, "production");

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "Production EMAIL_FROM must use the verified production site domain.",
    );
  });

  it("blocks workers.dev and the static-token admin API in production", () => {
    const unsafe = replaceConfig(
      replaceConfig(validProductionConfig, "workers_dev = false", "workers_dev = true"),
      'ADMIN_API_ENABLED = "false"',
      'ADMIN_API_ENABLED = "true"',
    );

    const result = validateWorkerDeployConfig(unsafe, "production");

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("Production deploy requires workers_dev=false.");
    expect(result.errors).toContain(
      "Production deploy requires ADMIN_API_ENABLED=false until Access is enforced.",
    );
  });
});
