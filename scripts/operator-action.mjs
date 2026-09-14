// Queues an audited operator action for the Worker's scheduled handler, or
// prints a read-only report. Access control is GitHub repository and
// environment permissions; the actor is stored with every request.
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { d1Client } from "./lib/d1-rest.mjs";

export const OPERATOR_ACTIONS = [
  "resend_access_link",
  "retry_invoice",
  "retry_invoice_email",
  "mark_storno_done",
  "reconcile_refund",
  "retry_refund",
  "requeue_generation",
  "resolve_anomalies",
];

export function validateOperatorInput({ action, publicId = "", argument = "" }) {
  const trimmedId = publicId.trim();
  const trimmedArgument = argument.trim();
  if (action === "report") return { action, publicId: "", argument: "" };
  if (!OPERATOR_ACTIONS.includes(action)) throw new Error(`Unknown action: ${action}`);
  if (trimmedArgument && !/^[A-Za-z0-9._:/-]{1,80}$/u.test(trimmedArgument)) {
    throw new Error("The argument may contain only letters, digits and . _ : / -");
  }
  const idOptional = action === "resolve_anomalies" && trimmedArgument;
  if (!idOptional && !/^[A-Za-z0-9_-]{8,80}$/u.test(trimmedId)) {
    throw new Error("A valid order public ID is required.");
  }
  if (action === "mark_storno_done" && !trimmedArgument) {
    throw new Error("mark_storno_done requires the storno invoice number as the argument.");
  }
  return { action, publicId: trimmedId || "-", argument: trimmedArgument };
}

const REPORT_QUERIES = {
  manual_refunds: "SELECT public_id FROM orders WHERE refund_manual_required = 1 AND payment_status IN ('paid', 'amount_mismatch', 'currency_mismatch') LIMIT 50",
  storno_required: "SELECT public_id FROM orders WHERE refund_invoice_status = 'manual_required' LIMIT 50",
  invoices_failed: "SELECT public_id FROM orders WHERE payment_status = 'paid' AND invoice_status = 'failed' LIMIT 50",
  chargebacks_open: "SELECT public_id FROM orders WHERE payment_status = 'chargeback_open' LIMIT 50",
  payment_anomalies: "SELECT COALESCE(o.public_id, a.stripe_object_id) || ' ' || a.reason AS public_id FROM payment_anomalies a LEFT JOIN orders o ON o.id = a.order_id WHERE a.resolved_at IS NULL LIMIT 50",
  generations_retrying: "SELECT public_id FROM orders WHERE ai_status = 'generating' AND generation_retry_count > 0 LIMIT 50",
  emails_dead: "SELECT e.kind || ' ' || COALESCE(o.public_id, '-') AS public_id FROM email_outbox e LEFT JOIN orders o ON o.id = e.order_id WHERE e.status = 'dead' ORDER BY e.created_at DESC LIMIT 50",
  recent_operator_requests: "SELECT action || ' ' || public_id || ' ' || status || ' ' || COALESCE(result, '') AS public_id FROM operator_requests ORDER BY created_at DESC LIMIT 20",
};

export async function run(env = process.env, queryImpl = null) {
  let input;
  try {
    input = validateOperatorInput({ action: env.OPERATOR_ACTION ?? "", publicId: env.PUBLIC_ID ?? "", argument: env.ARGUMENT ?? "" });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid input.");
    return 2;
  }
  const query = queryImpl ?? d1Client();

  if (input.action === "report") {
    const [heartbeat] = await query("SELECT last_run_at FROM ops_heartbeat WHERE name = 'scheduled'");
    console.log(`Scheduled Worker heartbeat: ${heartbeat?.last_run_at ?? "never"}`);
    for (const [name, sql] of Object.entries(REPORT_QUERIES)) {
      const rows = await query(sql);
      console.log(`\n${name} (${rows.length})`);
      for (const row of rows) console.log(`  ${row.public_id}`);
    }
    return 0;
  }

  const id = randomUUID();
  await query(
    "INSERT INTO operator_requests (id, action, public_id, argument, requested_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [id, input.action, input.publicId, input.argument || null, String(env.GITHUB_ACTOR ?? "unknown").slice(0, 80), new Date().toISOString()],
  );
  console.log(`Queued ${input.action} for ${input.publicId} (request ${id}); waiting for the scheduled Worker…`);

  const deadline = Date.now() + Number(env.OPERATOR_WAIT_MS ?? 240_000);
  while (Date.now() < deadline) {
    const [row] = await query("SELECT status, result FROM operator_requests WHERE id = ?", [id]);
    if (row?.status === "done" || row?.status === "failed") {
      console.log(`Result: ${row.status} – ${row.result}`);
      return row.status === "done" ? 0 : 1;
    }
    await new Promise((resolve) => setTimeout(resolve, Number(env.OPERATOR_POLL_MS ?? 10_000)));
  }
  console.error("The Worker did not process the request in time. Check the scheduled Worker heartbeat.");
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await run();
}
