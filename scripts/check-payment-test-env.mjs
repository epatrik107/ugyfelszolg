import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const workerEnvPath = resolve(root, "worker/.dev.vars");
const frontendEnvPath = resolve(root, "frontend/.env.local");
const errors = [];

function parseEnv(path) {
  if (!existsSync(path)) {
    errors.push(`Hiányzó helyi konfiguráció: ${path.replace(`${root}/`, "")}`);
    return {};
  }
  const values = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function requireValue(values, key, label = key) {
  if (!values[key] || /^<(?:PASTE|ADD|REPLACE)/iu.test(values[key])) {
    errors.push(`${label} nincs beállítva.`);
  }
}

function requireExact(values, key, expected) {
  if (values[key] !== expected) {
    errors.push(`${key} értéke helyi payment tesztnél pontosan ${expected} legyen.`);
  }
}

const worker = parseEnv(workerEnvPath);
const frontend = parseEnv(frontendEnvPath);

requireExact(worker, "PAYMENTS_ENABLED", "true");
requireExact(worker, "PAYMENT_MODE", "test");
requireExact(worker, "DEMO_MODE", "false");
requireExact(worker, "SZAMLAZZ_TEST_ACCOUNT_CONFIRMED", "true");
requireValue(worker, "GEMINI_API_KEY");
requireValue(worker, "TOKEN_HASH_SECRET");
requireValue(worker, "STRIPE_SECRET_KEY");
requireValue(worker, "STRIPE_WEBHOOK_SECRET");
requireValue(worker, "SZAMLAZZ_AGENT_KEY");
requireValue(worker, "ADMIN_API_TOKEN");

if (worker.STRIPE_SECRET_KEY && !worker.STRIPE_SECRET_KEY.startsWith("sk_test_")) {
  errors.push("A STRIPE_SECRET_KEY nem Stripe test kulcs (sk_test_…).");
}
if (worker.STRIPE_SECRET_KEY?.startsWith("sk_live_")) {
  errors.push("Live Stripe kulcs észlelve; a helyi teszt indítása blokkolva.");
}
if (worker.STRIPE_WEBHOOK_SECRET && !worker.STRIPE_WEBHOOK_SECRET.startsWith("whsec_")) {
  errors.push("A STRIPE_WEBHOOK_SECRET formátuma hibás (whsec_… szükséges).");
}
if (
  worker.SZAMLAZZ_AGENT_KEY &&
  worker.SZAMLAZZ_AGENT_KEY !== worker.SZAMLAZZ_AGENT_KEY.toLowerCase()
) {
  errors.push("A Számlázz.hu Agent kulcs csak kisbetűs lehet.");
}
if ((worker.TOKEN_HASH_SECRET?.length ?? 0) < 32) {
  errors.push("A TOKEN_HASH_SECRET legyen legalább 32 karakteres random érték.");
}
if ((worker.ADMIN_API_TOKEN?.length ?? 0) < 32) {
  errors.push("Az ADMIN_API_TOKEN legyen legalább 32 karakteres random érték.");
}

requireExact(frontend, "VITE_API_BASE_URL", "http://127.0.0.1:8787");
requireExact(frontend, "VITE_SITE_URL", "http://localhost:5173");
requireExact(frontend, "VITE_DEMO_MODE", "false");
requireExact(frontend, "VITE_TURNSTILE_SITE_KEY", "1x00000000000000000000AA");
requireExact(worker, "TURNSTILE_SECRET_KEY", "1x0000000000000000000000000000000AA");

if (errors.length > 0) {
  console.error("A payment test konfiguráció még nem biztonságos/komplett:");
  for (const error of errors) console.error(`  ✗ ${error}`);
  process.exit(1);
}

console.log("Payment test konfiguráció rendben:");
console.log("  ✓ Stripe test mód, live kulcs nélkül");
console.log("  ✓ Stripe webhook signing secret beállítva");
console.log("  ✓ Számlázz.hu tesztfiók explicit megerősítve");
console.log("  ✓ Admin invoice retry API token beállítva");
console.log("  ✓ Vevői számlaemail test módban letiltva");
console.log("  ✓ Cloudflare Turnstile hivatalos tesztkulcsok");
console.log("A parancs egyetlen secret értéket sem írt ki.");
