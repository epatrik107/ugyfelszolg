// Run only after sandbox deployment, using its isolated D1 and existing secrets.
// Synthetic data only: no Stripe session, invoice, or email is created.
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
assert.equal(process.env.DEPLOY_ENV, "sandbox", "Synthetic order tests are sandbox-only");
const api = new URL(process.env.API_HEALTH_URL);
assert.ok(api.hostname.includes("-sandbox."), "Sandbox hostname required");
const database = process.env.CLOUDFLARE_D1_DATABASE_ID;
assert.equal(database, "0b902117-8d55-49d4-8d9b-175281ad736f", "Only the dedicated sandbox database is allowed");
const id = `smoke_${randomUUID()}`;
const token = randomBytes(32).toString("hex");
const hash = createHmac("sha256", process.env.TOKEN_HASH_SECRET).update(token).digest("hex");
async function query(sql, params = []) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${database}/query`, {
    method: "POST", headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sql, params }), signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  assert.ok(response.ok && data.success && data.result.every((r) => r.success), `Sandbox D1 query failed (${response.status})`);
  return data.result[0].results;
}
async function result() {
  const response = await fetch(new URL(`/api/orders/${id}/result`, api), { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200, "Authenticated result polling failed");
  return (await response.json()).data;
}
async function awaitLetter(expectedCount) {
  for (let attempt = 0; attempt < 90; attempt++) {
    const current = await result();
    if (current.regenerationError) {
      const rows = await query("SELECT error_message FROM orders WHERE id = ?", [id]);
      throw new Error(`Synthetic regeneration rejected: ${rows[0]?.error_message}`);
    }
    assert.ok(!["failed", "failed_review"].includes(current.aiStatus), `Generation failed: ${current.aiStatus}`);
    if (current.aiStatus === "completed") {
      assert.equal(current.generationCount, expectedCount);
      assert.ok(current.generatedLetter?.length > 100);
      assert.equal(current.letterEmailSent, false);
      return current;
    }
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
  throw new Error("Scheduled generation did not finish within 15 minutes");
}
try {
  const now = new Date().toISOString();
  await query(`INSERT INTO orders (id, public_id, result_token_hash, email, name, letter_type, recipient,
    problem_description, desired_result, tone, selected_package, server_calculated_price, currency,
    payment_status, ai_status, generation_count, created_at, updated_at, paid_at, invoice_status)
    VALUES (?, ?, ?, ?, 'Minta Anna', 'Fizetési felszólítás', 'Teszt Bérlő',
    'A bérlő három hónapja nem fizeti a bérleti díjat. Szóban és írásban is kerestem, de nem válaszolt. Nem érem el, és zárcserével kizárt a lakásból. Ez az utolsó felszólításom, mielőtt jogi útra lépek.',
    'Szeretném, hogy fizessen, utána bontsuk fel a szerződést és távozzon a lakásból.', 'Határozott', 'basic', 890, 'huf',
    'paid', 'not_started', 0, ?, ?, ?, 'not_required')`, [id, id, hash, `${id}@example.invalid`, now, now, now]);
  const unauthorized = await fetch(new URL(`/api/orders/${id}/result`, api));
  assert.equal(unauthorized.status, 401);
  const first = await awaitLetter(1);
  function verifyFacts(letter) {
    assert.ok(letter.includes("Minta Anna"), "The supplied signer must be preserved");
    assert.match(letter, /(?:három|3)[ -]hónap/i, "The duration must be preserved");
    assert.match(letter, /bérleti díj|bérletidíj/i, "The request must concern rental arrears");
    assert.match(letter, /szerződés/i, "The request to end the contract must remain");
    assert.match(letter, /lakás/i, "The apartment handover must remain");
    assert.doesNotMatch(letter, /\d[\d .,]*\s*(?:Ft|forint)/i, "No amount was supplied");
  }
  verifyFacts(first.generatedLetter);
  // Only the ending may change. Compare the earlier paragraphs without
  // requiring a particular line-wrap or closing formula from the model.
  const closing = /^(?:(?:Tisztelettel|Üdvözlettel|Köszönettel)\s*[:!,.]?|(?:Előre is )?köszön(?:öm|jük)[^\n]*)\s*$/imu.exec(first.generatedLetter);
  assert.ok(closing, "Expected an identifiable closing");
  const unchangedPrefix = first.generatedLetter.slice(0, closing.index).replace(/\s+/g, " ").trim();
  assert.ok(unchangedPrefix.length > 80, "Expected a meaningful body to compare");
  const regenerated = await fetch(new URL(`/api/orders/${id}/regenerate`, api), {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ feedback: 'Csak a lezárást módosítsd: szerepeljen benne ez a mondat: "Kérem, válaszukat emailben küldjék el." A korábbi bekezdéseket szó szerint őrizd meg.' }),
  });
  assert.equal(regenerated.status, 200);
  const pending = await result();
  assert.equal(pending.generatedLetter, first.generatedLetter, "Previous letter must remain accessible");
  const second = await awaitLetter(2);
  assert.ok(second.letterHistory.includes(first.generatedLetter));
  verifyFacts(second.generatedLetter);
  assert.ok(second.generatedLetter.includes("Kérem, válaszukat emailben küldjék el."), "The targeted change must be present");
  assert.ok(second.generatedLetter.replace(/\s+/g, " ").trim().startsWith(unchangedPrefix), "Untargeted paragraphs must remain unchanged");
  const rows = await query("SELECT generation_run_id, generation_feedback, refund_requested_at, invoice_status FROM orders WHERE id = ?", [id]);
  assert.equal(rows[0].generation_run_id, null); assert.equal(rows[0].generation_feedback, null);
  assert.equal(rows[0].refund_requested_at, null); assert.equal(rows[0].invoice_status, "not_required");
  const reviews = await query("SELECT outcome, findings_json, prompt_version FROM generation_reviews WHERE order_id = ? ORDER BY created_at", [id]);
  assert.equal(reviews.filter((row) => row.outcome === "approved").length, 2, "Both scheduled generations must have persisted approval evidence");
  assert.ok(reviews.every((row) => row.prompt_version === "2026-09-18.2"));
  console.log("Sandbox smoke passed: authorization, real scheduled rental-letter generation/review, regeneration, persisted review diagnostics, source facts and signer, targeted closing change with unchanged earlier paragraphs, previous letter/history, no automatic email.");
} finally {
  // The run owns this UUID; no other order or user data is touched.
  await query("DELETE FROM order_status_log WHERE order_id = ?", [id]);
  await query("DELETE FROM orders WHERE id = ? AND email = ? AND stripe_payment_intent_id IS NULL", [id, `${id}@example.invalid`]);
  console.log("Synthetic sandbox order cleaned up.");
}
