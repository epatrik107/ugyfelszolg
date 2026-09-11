# Audit remediation plan — 2026-09-11

Scope: A01–A12 from the project audit. Keep the current production domains and compatible payment/result APIs.

1. **Durable processing (A02–A05, A07).** Persist generation work and feedback on the order atomically. Claim work with an expiring lease in the one-minute scheduled handler. Preserve the last successful letter on regeneration failure, including interrupted jobs. Record refund intent before network requests; retry and reconcile with the same Stripe idempotency key. Include pending invoices in recovery. Keep retention cleanup on its daily schedule.
2. **Access and rate limits (A06, A09).** Enforce content expiry in routes and conditional SQL. Use atomic D1 counters instead of KV read/modify/write. Adjust result polling to a bounded, non-overlapping backoff schedule and expose regeneration errors without hiding the last successful result.
3. **Frontend and HTTPS (A01, A08).** Enforce GitHub Pages HTTPS. Apply response headers at the real serving layer, preserve SPA deep links, and add frontend deployment verification. Reset used contact Turnstile tokens on failed submissions.
4. **CI/deploy (A10–A12).** Upgrade Vitest to 4.1.11; separate Worker/test TypeScript environments. Reuse the full quality workflow from both deployments. Dynamically verify every migration, exercise real SQLite state transitions, and fix the post-publication health/rollback conditions. Verify schema and deployed revision.
5. **Release.** Run local build, tests, audit and Worker bundling; push a focused PR and wait for CI. Deploy the branch to sandbox and run read-only endpoint checks. Merge after checks, deploy production Worker and frontend, then verify HTTPS, headers, CORS, routes, health, revision and cron behavior. Record exact evidence and remaining external dependencies.

Acceptance: each audit reproduction becomes a regression test for corrected behavior; no long AI work in HTTP waitUntil; existing results survive failed modifications; refunds survive network failure; no refund for failed modifications; expired orders cannot regenerate; concurrency cannot exceed the configured D1 limit; both deployments depend on the complete quality gate.

Testing uses synthetic data and mocked external payments for destructive/failure paths. Production verification uses read-only requests and deployment metadata; a real card charge is not needed to validate this release.
