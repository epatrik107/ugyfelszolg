import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { OPERATOR_ACTIONS, run as runOperatorAction, validateOperatorInput } from "../../scripts/operator-action.mjs";
import { REQUIRED_STRIPE_EVENTS, checkStripeWebhookEndpoints, evaluateOpsState } from "../../scripts/ops-watch.mjs";
import { verifyBackupSql } from "../../scripts/verify-d1-backup.mjs";

describe("operator action workflow input", () => {
  it("accepts only allow-listed actions and safe identifiers", () => {
    expect(validateOperatorInput({ action: "retry_invoice", publicId: "0b1e4a0c-7b8f-4b7c-9a31-2c7d3f1e9a55" }).publicId).toBe("0b1e4a0c-7b8f-4b7c-9a31-2c7d3f1e9a55");
    expect(() => validateOperatorInput({ action: "drop_table", publicId: "abcdefgh" })).toThrow("Unknown action");
    expect(() => validateOperatorInput({ action: "retry_invoice", publicId: "x' OR 1=1 --" })).toThrow("public ID");
    expect(() => validateOperatorInput({ action: "mark_storno_done", publicId: "abcdefgh" })).toThrow("storno invoice number");
    expect(() => validateOperatorInput({ action: "mark_storno_done", publicId: "abcdefgh", argument: "E-1; DROP" })).toThrow("argument");
    expect(validateOperatorInput({ action: "resolve_anomalies", argument: "cs_test_123" }).publicId).toBe("-");
  });

  it("matches the database allow-list trigger", () => {
    const migration = readFileSync(new URL("../migrations/0014_fulfillment_recovery_and_operations.sql", import.meta.url), "utf8");
    for (const action of OPERATOR_ACTIONS) expect(migration).toContain(`'${action}'`);
  });

  it("inserts a parameterized, attributed request and reports the Worker result", async () => {
    const calls = [];
    const query = vi.fn(async (sql, params = []) => {
      calls.push({ sql, params });
      return sql.startsWith("SELECT status") ? [{ status: "done", result: "storno_recorded" }] : [];
    });
    const code = await runOperatorAction({ OPERATOR_ACTION: "mark_storno_done", PUBLIC_ID: "public_123", ARGUMENT: "E-STORNO-1", GITHUB_ACTOR: "owner", OPERATOR_POLL_MS: "1" }, query);
    expect(code).toBe(0);
    expect(calls[0].sql).not.toContain("public_123");
    expect(calls[0].params).toEqual([expect.any(String), "mark_storno_done", "public_123", "E-STORNO-1", "owner", expect.any(String)]);
  });
});

describe("ops watchdog", () => {
  it("flags a stale scheduler, undelivered alerts and long-failing webhooks", () => {
    const now = Date.parse("2026-09-14T12:00:00Z");
    expect(evaluateOpsState({ now, heartbeatAt: "2026-09-14T11:59:00Z", undeliveredAlerts: 0, oldFailedWebhooks: 0 })).toEqual([]);
    expect(evaluateOpsState({ now, heartbeatAt: "2026-09-14T11:40:00Z", undeliveredAlerts: 1, oldFailedWebhooks: 2 })).toHaveLength(3);
    expect(evaluateOpsState({ now, heartbeatAt: null, undeliveredAlerts: 0, oldFailedWebhooks: 0 })).toHaveLength(1);
    expect(evaluateOpsState({ now, heartbeatAt: "2026-09-14T11:59:00Z", heartbeatDetail: '{"failures":["email_outbox"]}', undeliveredAlerts: 0, oldFailedWebhooks: 0 })[0]).toContain("email_outbox");
  });

  it("requires exactly one enabled Stripe endpoint on the API domain with every handled event", () => {
    const url = "https://api.levelseged.hu/api/stripe/webhook";
    expect(checkStripeWebhookEndpoints([{ id: "we_1", url, status: "enabled", enabled_events: REQUIRED_STRIPE_EVENTS }], url)).toEqual([]);
    expect(checkStripeWebhookEndpoints([{ id: "we_1", url: "https://api.old.example/api/stripe/webhook", status: "enabled", enabled_events: ["*"] }], url)[0]).toContain("No Stripe webhook");
    expect(checkStripeWebhookEndpoints([{ id: "we_1", url, status: "disabled", enabled_events: ["*"] }], url)[0]).toContain("disabled");
    expect(checkStripeWebhookEndpoints([{ id: "we_1", url, status: "enabled", enabled_events: ["checkout.session.completed"] }], url)[0]).toContain("charge.dispute.closed");
  });
});

describe("backup restore drill", () => {
  const dump = `PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE orders (id TEXT PRIMARY KEY);
CREATE TABLE invoices (id TEXT PRIMARY KEY, order_id TEXT REFERENCES orders(id));
CREATE TABLE order_status_log (id TEXT PRIMARY KEY);
CREATE TABLE payment_refunds (id TEXT PRIMARY KEY);
CREATE TABLE payment_disputes (id TEXT PRIMARY KEY);
CREATE TABLE processed_stripe_events (event_id TEXT PRIMARY KEY);
CREATE TABLE email_outbox (id TEXT PRIMARY KEY);
INSERT INTO orders VALUES ('o1'), ('o2');
INSERT INTO invoices VALUES ('i1', 'o1');`;

  it("restores a dump and accepts rows written after counting", () => {
    expect(verifyBackupSql(dump, { orders: 1, invoices: 1 }).problems).toEqual([]);
  });

  it("rejects a dump that lost rows or tables", () => {
    expect(verifyBackupSql(dump, { orders: 3 }).problems[0]).toContain("orders");
    expect(verifyBackupSql(dump.replace("CREATE TABLE email_outbox (id TEXT PRIMARY KEY);", ""), {}).problems).toContain("Missing table email_outbox.");
  });
});
