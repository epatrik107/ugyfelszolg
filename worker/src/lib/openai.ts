import {
  commitReservedQuota,
  completeGeneration,
  failGeneration,
  releaseReservedQuota,
} from "./db";
import { logEvent } from "./logger";
import { reviewLetterWithRules } from "./review";
import type { Env, OrderRow } from "./types";

const systemPrompt =
  "Te egy magyar nyelvű ügyintéző és hivatalos levélíró asszisztens vagy. " +
  "A feladatod, hogy a felhasználó által megadott probléma alapján kulturált, határozott, hivatalos hangvételű magyar levelet írj.\n\n" +
  "KÖTELEZŐ FORMAI KÖVETELMÉNYEK:\n" +
  "- Az első sor pontosan így kezdődjön: 'Tárgy: [rövid tárgy]' (csak ez a szó, kettőspont, szóköz, szöveg)\n" +
  "- Ezután üres sor, majd megszólítás (pl. 'Tisztelt Cím!')\n" +
  "- Bevezető bekezdés, probléma kifejtése, kérés, udvarias lezárás, aláírás helye\n" +
  "- Minden bekezdés között üres sor legyen\n\n" +
  "TILTOTT TARTALMAK:\n" +
  "- Konkrét jogi tanács, jogszabályra hivatkozás (kivéve ha a felhasználó megadta)\n" +
  "- Biztos jogi következmény állítása\n" +
  "- Fenyegetőző, agresszív hangnem\n" +
  "- Biztos eredmény ígérete\n" +
  "- Pereskedés vagy hatósági eljárás javaslata jogi tanácsként\n\n" +
  "FORMÁZÁS:\n" +
  "- Kizárólag sima szöveget adj vissza\n" +
  "- TILOS minden markdown jelölő: **, *, #, _, >, -, felsorolásjelek\n" +
  "- Tilos HTML vagy más formázónyelvek használata\n" +
  "- A levél kommunikációs segítség, nem jogi dokumentum";

function buildUserPrompt(order: OrderRow, reviewIssues: string[] = []) {
  const correction =
    reviewIssues.length > 0
      ? `\n\nAz előző változat javítandó pontjai:\n- ${reviewIssues.join("\n- ")}\nKészíts új, javított változatot.`
      : "";

  const taskLine = order.attached_letter
    ? "Készíts választ az alábbi beérkezett levélre a megadott szempontok alapján."
    : "Készíts hivatalos magyar nyelvű levelet az alábbi adatok alapján.";

  const attachedSection = order.attached_letter
    ? `\nBeérkezett levél (amelyre válaszolni kell):\n${order.attached_letter}\n`
    : "";

  return `${taskLine}${attachedSection}
Levél típusa:
${order.letter_type}

Címzett:
${order.recipient}

Probléma leírása / szempontok:
${order.problem_description}

Elérni kívánt eredmény:
${order.desired_result}

Kért hangnem:
${order.tone}

Korábbi levelezés vagy előzmény:
${order.previous_messages ?? ""}

Választott csomag:
${order.selected_package}

A levél tartalmazza:
- Tárgy
- Megszólítás
- Bevezetés
- A probléma / válasz világos kifejtése
- Kérés / elvárt megoldás
- Udvarias, de határozott lezárás
- Aláírás helye

Ha prémium csomag, akkor a levél után adj:
- Alternatív tárgymezőt
- Alternatív zárómondatot
- Rövid használati javaslatot

Ne adj jogi tanácsot.
Ne hivatkozz jogszabályra, ha azt a felhasználó nem adta meg.${correction}`;
}

async function callGemini(env: Env, model: string, input: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: input }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini API error (${response.status})`);
  }

  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  const text = payload.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? "")
    .join("")
    .trim();

  if (!text) {
    throw new Error("Gemini empty response.");
  }
  return text;
}

async function reviewWithAi(env: Env, letter: string) {
  const model = env.GEMINI_REVIEW_MODEL || "gemini-3.1-flash-lite";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: {
        parts: [
          {
            text:
              "Te egy magyar nyelvű minőségellenőr vagy. Kizárólag a levél TARTALMÁT vizsgálod (a formai ellenőrzést más rendszer végzi).\n\n" +
              "Vizsgáld meg, hogy a levél:\n" +
              "1. Tartalmaz-e konkrét jogi, egészségügyi vagy pénzügyi tanácsot (nem csak tájékoztatást)\n" +
              "2. Állít-e biztos jogi következményt ('ez jogsértés', 'kötelezhetők', 'bírságot kapnak' stb.)\n" +
              "3. Fenyegetőző, zsaroló vagy agresszív-e a hangvétele\n" +
              "4. Tartalmaz-e valótlan vagy félrevezető tényt\n" +
              "5. Javasol-e konkrét hatósági eljárást jogi tanácsként (nem csak lehetőségként megemlítve)\n\n" +
              "Ha ezek egyike sem áll fenn, akkor ok=true. Csak JSON-t adj vissza: {\"ok\": boolean, \"issues\": string[]}",
          },
        ],
      },
      contents: [{ role: "user", parts: [{ text: letter }] }],
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: 512 },
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini review error (${response.status})`);
  }

  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const raw = payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "{}";
  const parsed = JSON.parse(raw) as { ok?: boolean; issues?: string[] };
  return {
    ok: parsed.ok === true,
    issues: Array.isArray(parsed.issues) ? parsed.issues : [],
  };
}

export async function generateLetterForPaidOrder(env: Env, order: OrderRow) {
  const isPremium = order.selected_package === "premium" || order.selected_package === "business";
  const model = isPremium
    ? (env.GEMINI_MODEL_PREMIUM || env.GEMINI_MODEL || "gemini-3.5-flash")
    : (env.GEMINI_MODEL || "gemini-3.1-flash-lite");

  try {
    logEvent("ai_generation_started", { orderId: order.id });
    let reviewIssues: string[] = [];

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const letter = await callGemini(env, model, buildUserPrompt(order, reviewIssues));
      const ruleReview = reviewLetterWithRules(letter);

      // AI review is advisory: log issues but do not block on them
      try {
        const aiReview = await reviewWithAi(env, letter);
        if (!aiReview.ok) {
          logEvent("ai_review_advisory_issues", { orderId: order.id, attempt, issues: aiReview.issues });
        }
        reviewIssues = [...ruleReview.issues, ...aiReview.issues];
      } catch (reviewErr) {
        logEvent("ai_review_error", { orderId: order.id, reason: reviewErr instanceof Error ? reviewErr.message : "unknown" });
        reviewIssues = ruleReview.issues;
      }

      if (ruleReview.ok) {
        await completeGeneration(env, order.id, letter);
        if (order.subscription_id) {
          await commitReservedQuota(env, order.subscription_id);
        }
        logEvent("ai_generation_completed", { orderId: order.id });
        return;
      }

      logEvent("ai_rule_review_failed", { orderId: order.id, attempt, issues: ruleReview.issues });
    }

    await failGeneration(
      env,
      order.id,
      "failed_review",
      "Automatikus minőségellenőrzés sikertelen.",
    );
    if (order.subscription_id) {
      await releaseReservedQuota(env, order.subscription_id);
    }
    logEvent("ai_generation_failed", {
      orderId: order.id,
      reason: "review_failed",
    });
  } catch (error) {
    await failGeneration(env, order.id, "failed", "Generálási hiba.");
    if (order.subscription_id) {
      await releaseReservedQuota(env, order.subscription_id);
    }
    logEvent("ai_generation_failed", {
      orderId: order.id,
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
}
