import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_CONFIG_PATH = "worker/wrangler.toml";
const VALID_TARGETS = new Set(["sandbox", "production"]);

function stripInlineComment(line) {
  let inString = false;
  let escaped = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (char === "#" && !inString) {
      return line.slice(0, i);
    }
  }

  return line;
}

function parseTomlValue(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

export function parseWorkerToml(source) {
  const parsed = {
    root: {},
    vars: {},
    d1: {},
    kv: {},
  };
  let section = "root";

  for (const rawLine of source.split(/\r?\n/u)) {
    const line = stripInlineComment(rawLine).trim();
    if (!line) continue;

    if (line === "[vars]") {
      section = "vars";
      continue;
    }
    if (line === "[[d1_databases]]") {
      section = "d1";
      continue;
    }
    if (line === "[[kv_namespaces]]") {
      section = "kv";
      continue;
    }
    if (line.startsWith("[") && line.endsWith("]")) {
      section = "other";
      continue;
    }

    const match = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/u);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (section in parsed) {
      parsed[section][key] = parseTomlValue(rawValue);
    }
  }

  return parsed;
}

function hasValue(value) {
  return typeof value === "string" ? value.trim().length > 0 : Boolean(value);
}

function isPlaceholder(value) {
  const normalized = String(value ?? "").trim();
  return (
    !normalized ||
    /^(test|teszt|example|placeholder|replace|replace_with|todo|tbd)$/iu.test(normalized) ||
    /REPLACE_WITH|PASTE|ADD_/iu.test(normalized) ||
    /^0+X+$/iu.test(normalized)
  );
}

function isHttpsUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function splitOrigins(value) {
  return String(value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function hasLocalhostUrl(value) {
  try {
    const parsed = new URL(value);
    return ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function validateBindings(config, errors) {
  const d1DatabaseId = String(config.d1.database_id ?? "");
  const kvNamespaceId = String(config.kv.id ?? "");

  if (!hasValue(config.root.name)) {
    errors.push("Worker name is missing.");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(d1DatabaseId)) {
    errors.push("D1 database_id must be a real UUID, not a placeholder.");
  }
  if (!/^[0-9a-f]{32}$/iu.test(kvNamespaceId)) {
    errors.push("RATE_LIMIT_KV id must be a real KV namespace ID, not a placeholder.");
  }
}

function validateProduction(config, errors) {
  const vars = config.vars;
  const origins = splitOrigins(vars.ALLOWED_ORIGINS);
  const urls = [vars.SITE_URL, ...origins].filter(hasValue);

  if (vars.DEMO_MODE !== "false") {
    errors.push("Production deploy requires DEMO_MODE=false.");
  }
  if (vars.PAYMENTS_ENABLED !== "true") {
    errors.push("Production deploy requires PAYMENTS_ENABLED=true.");
  }
  if (vars.PAYMENT_MODE !== "live") {
    errors.push("Production deploy requires PAYMENT_MODE=live.");
  }
  if (vars.SZAMLAZZ_TEST_ACCOUNT_CONFIRMED === "true") {
    errors.push("Production deploy cannot confirm a Szamlazz.hu test account.");
  }
  if (!hasValue(vars.SITE_URL)) {
    errors.push("Production SITE_URL is missing.");
  }
  if (origins.length === 0) {
    errors.push("Production ALLOWED_ORIGINS is missing.");
  }
  if (urls.some((url) => !isHttpsUrl(String(url)))) {
    errors.push("Production SITE_URL and ALLOWED_ORIGINS must be HTTPS URLs.");
  }
  if (urls.some((url) => hasLocalhostUrl(String(url)))) {
    errors.push("Production deploy cannot use localhost URLs.");
  }
  if (/(sandbox|test)/iu.test(String(config.root.name ?? ""))) {
    errors.push("Production Worker name cannot contain sandbox or test.");
  }
  if (/(sandbox|test)/iu.test(String(config.d1.database_name ?? ""))) {
    errors.push("Production D1 database_name cannot contain sandbox or test.");
  }
  if (isPlaceholder(vars.SELLER_NAME)) {
    errors.push("Production SELLER_NAME must be set to the legal seller name.");
  }
  if (isPlaceholder(vars.SELLER_ADDRESS)) {
    errors.push("Production SELLER_ADDRESS must be set to the legal seller address.");
  }
  if (isPlaceholder(vars.SELLER_TAX_NUMBER)) {
    errors.push("Production SELLER_TAX_NUMBER must be set to the legal seller tax number.");
  }
  if (isPlaceholder(vars.EMAIL_FROM) || /example\.com/iu.test(String(vars.EMAIL_FROM ?? ""))) {
    errors.push("Production EMAIL_FROM must be a real sender address.");
  }
}

function validateSandbox(config, errors) {
  const vars = config.vars;

  if (vars.PAYMENTS_ENABLED === "true") {
    if (vars.PAYMENT_MODE !== "test") {
      errors.push("Sandbox payment deploy requires PAYMENT_MODE=test.");
    }
    if (vars.SZAMLAZZ_TEST_ACCOUNT_CONFIRMED !== "true") {
      errors.push("Sandbox payment deploy requires SZAMLAZZ_TEST_ACCOUNT_CONFIRMED=true.");
    }
    if (!/(sandbox|test)/iu.test(String(config.root.name ?? ""))) {
      errors.push("Sandbox payment Worker name should contain sandbox or test.");
    }
    if (!/(sandbox|test)/iu.test(String(config.d1.database_name ?? ""))) {
      errors.push("Sandbox payment D1 database_name should contain sandbox or test.");
    }
  }
}

export function validateWorkerDeployConfig(source, target) {
  const errors = [];
  const config = parseWorkerToml(source);
  const deployTarget = String(target ?? "").trim();

  if (!VALID_TARGETS.has(deployTarget)) {
    errors.push("Set WORKER_DEPLOY_TARGET to sandbox or production before deploying.");
  }

  validateBindings(config, errors);

  if (deployTarget === "production") {
    validateProduction(config, errors);
  }
  if (deployTarget === "sandbox") {
    validateSandbox(config, errors);
  }

  return {
    ok: errors.length === 0,
    errors,
    config,
  };
}

function resolveConfigPath(inputPath) {
  const requested = inputPath || DEFAULT_CONFIG_PATH;
  const direct = resolve(process.cwd(), requested);
  if (existsSync(direct)) return direct;

  const parent = resolve(process.cwd(), "..", requested);
  if (existsSync(parent)) return parent;

  if (basename(process.cwd()) === "worker") {
    const workerLocal = resolve(process.cwd(), "wrangler.toml");
    if (existsSync(workerLocal)) return workerLocal;
  }

  return direct;
}

export function run(argv = process.argv, env = process.env) {
  const explicitConfigArg = argv.find((arg) => arg.startsWith("--config="));
  const configPath = resolveConfigPath(
    env.WRANGLER_CONFIG || explicitConfigArg?.slice("--config=".length),
  );

  if (!existsSync(configPath)) {
    console.error(`Worker deploy preflight failed: missing config file ${configPath}`);
    return 1;
  }

  const source = readFileSync(configPath, "utf8");
  const target = env.WORKER_DEPLOY_TARGET || env.DEPLOY_ENV;
  const result = validateWorkerDeployConfig(source, target);

  if (!result.ok) {
    console.error("Worker deploy preflight failed:");
    for (const error of result.errors) {
      console.error(`  x ${error}`);
    }
    console.error("No secrets were printed.");
    return 1;
  }

  console.log(`Worker deploy preflight passed for ${target}.`);
  return 0;
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  process.exitCode = run();
}
