import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const REQUIRED_WORKER_SECRETS = [
  "CLOUDFLARE_API_TOKEN",
  "GEMINI_API_KEY",
  "RESEND_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "SZAMLAZZ_AGENT_KEY",
  "TOKEN_HASH_SECRET",
  "TURNSTILE_SECRET_KEY",
];

export const REQUIRED_SANDBOX_WORKER_SECRETS = [
  "CLOUDFLARE_API_TOKEN",
  "GEMINI_API_KEY",
  "RESEND_API_KEY",
  "TOKEN_HASH_SECRET",
  "TURNSTILE_SECRET_KEY",
];

export const REQUIRED_WORKER_VARIABLES = [
  "ADMIN_API_ENABLED",
  "ALLOWED_ORIGINS",
  "API_HEALTH_URL",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_D1_DATABASE_ID",
  "CLOUDFLARE_KV_NAMESPACE_ID",
  "D1_DATABASE_NAME",
  "EMAIL_FROM",
  "GEMINI_MODEL",
  "GEMINI_MODEL_PREMIUM",
  "GEMINI_REVIEW_MODEL",
  "LEGAL_TERMS_VERSION",
  "PRIVACY_POLICY_VERSION",
  "SELLER_ADDRESS",
  "SELLER_NAME",
  "SELLER_TAX_NUMBER",
  "SITE_URL",
  "TURNSTILE_EXPECTED_HOSTNAMES",
  "WORKER_NAME",
];

export const REQUIRED_FRONTEND_VARIABLES = [
  "VITE_API_BASE_URL",
  "VITE_BASE_PATH",
  "VITE_DEMO_MODE",
  "VITE_SITE_URL",
  "VITE_TURNSTILE_SITE_KEY",
];

const OPTIONAL_SANDBOX_SECRETS = ["ADMIN_API_TOKEN"];
const FORBIDDEN_PRODUCTION_SECRETS = ["ADMIN_API_TOKEN", "DEMO_ACCESS_CODE"];

function sorted(values) {
  return [...new Set(values)].sort();
}

function difference(actual, expected) {
  const expectedSet = new Set(expected);
  return sorted(actual.filter((name) => !expectedSet.has(name)));
}

function intersection(left, right) {
  const rightSet = new Set(right);
  return sorted(left.filter((name) => rightSet.has(name)));
}

export function auditEnvironment({
  environment,
  secrets,
  variables,
  repositorySecrets = [],
  repositoryVariables = [],
}) {
  const requiredSecrets =
    environment === "github-pages"
      ? []
      : environment === "sandbox"
        ? REQUIRED_SANDBOX_WORKER_SECRETS
        : REQUIRED_WORKER_SECRETS;
  const requiredVariables =
    environment === "production"
      ? [...REQUIRED_WORKER_VARIABLES, ...REQUIRED_FRONTEND_VARIABLES]
      : environment === "sandbox"
        ? REQUIRED_WORKER_VARIABLES
        : [];
  const allowedSecrets =
    environment === "sandbox"
      ? [...requiredSecrets, ...OPTIONAL_SANDBOX_SECRETS]
      : requiredSecrets;

  return {
    environment,
    missingSecrets: difference(requiredSecrets, secrets),
    unexpectedSecrets: difference(secrets, allowedSecrets),
    missingVariables: difference(requiredVariables, variables),
    unexpectedVariables: difference(variables, requiredVariables),
    repositorySecretDuplicates: intersection(secrets, repositorySecrets),
    repositoryVariableDuplicates: intersection(variables, repositoryVariables),
    forbiddenProductionSecrets:
      environment === "production"
        ? intersection(secrets, FORBIDDEN_PRODUCTION_SECRETS)
        : [],
  };
}

export function auditRepository({ secrets, variables }) {
  return {
    environment: "repository",
    unexpectedSecrets: sorted(secrets),
    unexpectedVariables: sorted(variables),
  };
}

export function auditPassed(result) {
  return Object.entries(result).every(
    ([key, value]) => key === "environment" || !Array.isArray(value) || value.length === 0,
  );
}

function ghJson(args) {
  const output = execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const payload = JSON.parse(output || "[]");
  return sorted(payload.map((item) => item.name).filter(Boolean));
}

function listSecrets(repository, environment) {
  const args = ["secret", "list", "--repo", repository, "--json", "name"];
  if (environment) args.push("--env", environment);
  return ghJson(args);
}

function listVariables(repository, environment) {
  const args = ["variable", "list", "--repo", repository, "--json", "name"];
  if (environment) args.push("--env", environment);
  return ghJson(args);
}

function printNames(label, names) {
  console.log(`  ${label}: ${names.length > 0 ? names.join(", ") : "none"}`);
}

function repositoryFromArgs(argv) {
  const index = argv.indexOf("--repo");
  return index >= 0 ? argv[index + 1] : process.env.GH_REPO || "epatrik107/ugyfelszolg";
}

export function run(argv = process.argv.slice(2)) {
  const repository = repositoryFromArgs(argv);
  if (!repository || !/^[^/\s]+\/[^/\s]+$/u.test(repository)) {
    console.error("A repositoryt owner/name formában add meg a --repo kapcsolóval.");
    return 2;
  }

  try {
    execFileSync("gh", ["auth", "status", "-h", "github.com"], {
      stdio: "ignore",
    });
  } catch {
    console.error("A GitHub CLI nincs hitelesítve. Futtasd: gh auth login -h github.com");
    return 2;
  }

  try {
    const repositorySecrets = listSecrets(repository);
    const repositoryVariables = listVariables(repository);
    let ok = true;

    console.log(`GitHub config audit: ${repository}`);
    console.log("Csak neveket ellenőriz; secret- és variable-értéket nem kér le.");

    const repositoryResult = auditRepository({
      secrets: repositorySecrets,
      variables: repositoryVariables,
    });
    ok = auditPassed(repositoryResult) && ok;

    console.log("\n[repository]");
    printNames("nem várt/unscoped secretek", repositoryResult.unexpectedSecrets);
    printNames("nem várt/unscoped variable-ök", repositoryResult.unexpectedVariables);

    for (const environment of ["sandbox", "production", "github-pages"]) {
      const result = auditEnvironment({
        environment,
        secrets: listSecrets(repository, environment),
        variables: listVariables(repository, environment),
        repositorySecrets,
        repositoryVariables,
      });
      ok = auditPassed(result) && ok;

      console.log(`\n[${environment}]`);
      printNames("hiányzó secretek", result.missingSecrets);
      printNames("nem várt/stale secretek", result.unexpectedSecrets);
      printNames("hiányzó variable-ök", result.missingVariables);
      printNames("nem várt/stale variable-ök", result.unexpectedVariables);
      printNames("repo+environment secret duplikáció", result.repositorySecretDuplicates);
      printNames("repo+environment variable duplikáció", result.repositoryVariableDuplicates);
      printNames("productionben tiltott secretek", result.forbiddenProductionSecrets);
    }

    return ok ? 0 : 1;
  } catch {
    console.error(
      "A GitHub konfiguráció nem olvasható. Ellenőrizd, hogy az aktív account admin hozzáférésű-e a repositoryhoz.",
    );
    return 2;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = run();
}
