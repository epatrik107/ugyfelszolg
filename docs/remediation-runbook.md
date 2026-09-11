# Audit remediation operation and verification

The A01–A12 implementation is described in `remediation-plan-2026-09-11.md`.

## Durable jobs

The Worker runs every minute. A single atomic D1 statement claims up to four paid generation jobs, including payments whose HTTP handler stopped before activation. Feedback is stored with the regeneration state. Claims last 20 minutes; Cloudflare scheduled invocations have a [15-minute wall-time limit](https://developers.cloudflare.com/workers/platform/limits/). A unique claim token guards completion and failure. Interrupted attempts are recovered; after three interrupted executions the next claim records failure.

A failed regeneration retains the previous letter and email state and restores its modification allowance. It never schedules an automatic refund. The API continues to expose the previous letter while the modification runs. Content older than 90 days or already redacted cannot be regenerated, exposed, or emailed. Retention runs at 02:17 UTC and also clears any content accidentally reintroduced into a redacted row.

First-generation failure and its refund intent are one D1 update. Refund jobs claim atomically, use Stripe's existing `refund-{paymentIntentId}` idempotency key, persist the returned refund ID, and retrieve pending refunds by ID. Network failures retry after 1, 5, 15, 60 and 120 minutes. Six unsuccessful attempts, or an unknown outcome more than 20 hours old, require operator reconciliation; the system never blindly retries beyond Stripe's idempotency guarantee. Pre-migration failures with unknown refund outcomes are marked for reconciliation rather than submitted again.

Pending invoices and due retries are scanned every minute. Invoice attempts retain the existing atomic claim and bounded retry policy. A generation, refund, invoice or retention failure does not stop the other job classes.

Read-only operational queries (run against the explicitly selected environment):

```sql
SELECT COUNT(*) AS manual_refunds FROM orders WHERE refund_manual_required = 1 AND payment_status = 'paid';
SELECT COUNT(*) AS overdue_generations FROM orders WHERE ai_status = 'generating' AND COALESCE(generation_claimed_at, updated_at) < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-20 minutes');
SELECT invoice_status, COUNT(*) FROM orders WHERE payment_status = 'paid' AND invoice_status IN ('pending', 'processing', 'retry_required', 'failed') GROUP BY invoice_status;
```

For a manual refund, first reconcile the payment intent and any refund ID in Stripe, then update the existing order/refund ledger through the established reconciliation path. Do not create a new payment-intent refund without checking whether the original request succeeded. Invoice correction remains a separate accounting operation.

## Deployment and rollback

Both dispatch workflows run the same full `Quality checks` workflow for the dispatched revision: type checking, all tests, build, moderate-or-higher dependency audit, secret scan and every SQL migration with foreign keys enabled. Production accepts only `main`.

The Worker migration is additive. Before rollout the workflow records the active Worker version and a D1 Time Travel bookmark. The health gate verifies security headers, schema 13 and the exact `GITHUB_SHA`. It runs even after stale-secret cleanup fails. Worker publication, cleanup or health failure triggers rollback to the captured version. An additive migration is left in place during code rollback; restoring the database would discard subsequent customer writes and is not an automatic action.

Sandbox deployment additionally creates one uniquely tagged synthetic paid order without a Stripe session/payment intent and with invoicing disabled. It tests authentication, real scheduled Gemini generation and review, regeneration, retained content and history. It cleans up only its own synthetic row. Real payment failures/refund retries are covered with real SQLite and stubbed external providers; production checks do not charge a card.

The frontend health gate checks HTTP-to-HTTPS redirect, response security headers, application assets, SPA fallback and `build.json` revision. The fallback script is external to support a strict CSP. Existing GitHub Pages remains the origin; Cloudflare supplies response headers. `_headers` documents the policy for compatible static hosts but GitHub Pages does not interpret it. Keep the matching Cloudflare response-header rule enabled for `levelseged.hu`; its exact values and rule IDs are versioned in `infra/frontend-security.json`. The header policy temporarily permits the exact previous release’s SPA redirect script by SHA-256, so cached old fallback pages keep working during rollout.

Letter email is user-initiated for all current packages, matching `sendsEmailByDefault` and the published flow. Payment/refund/invoice transactional mail is separate.
