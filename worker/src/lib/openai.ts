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
  "Te egy magyar nyelvű ügyintéző és hivatalos levélíró asszisztens vagy. A feladatod, hogy a felhasználó által megadott probléma alapján kulturált, határozott, hivatalos hangvételű levelet írj. Nem adhatsz jogi tanácsot. Nem hivatkozhatsz konkrét jogszabályra, ha azt a felhasználó nem adta meg. A levél legyen udvarias, világos, jól tagolt, nem fenyegetőző, de határozott. Ne ígérj biztos eredményt. Ne állíts biztos jogi következményeket. Ne javasolj pereskedést vagy hatósági eljárást jogi tanácsként. A levél kommunikációs segítség legyen.";

function buildUserPrompt(order: OrderRow, reviewIssues: string[] = []) {
  const correction =
    reviewIssues.length > 0
      ? `\n\nAz előző változat javítandó pontjai:\n- ${reviewIssues.join("\n- ")}\nKészíts új, javított változatot.`
      : "";

  return `Készíts hivatalos magyar nyelvű levelet az alábbi adatok alapján.

Levél típusa:
${order.letter_type}

Címzett:
${order.recipient}

Probléma leírása:
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
- A probléma világos leírása
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
  const model = env.GEMINI_REVIEW_MODEL || "gemini-2.5-flash-lite";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: "Magyar nyelvű minőségellenőr vagy. Csak JSON-t adj vissza a következő alakban: {\"ok\": boolean, \"issues\": string[]}. Akkor legyen ok=false, ha a levél konkrét jogi, egészségügyi vagy pénzügyi tanácsot ad, biztos jogi következményt állít, fenyegetőző, túl agresszív, vagy hiányzik belőle tárgy, megszólítás, világos kérés, udvarias lezárás, illetve nem magyar nyelvű." }],
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
    ? (env.GEMINI_MODEL_PREMIUM || env.GEMINI_MODEL || "gemini-2.5-flash-lite")
    : (env.GEMINI_MODEL || "gemini-2.5-flash-lite");

  try {
    logEvent("ai_generation_started", { orderId: order.id });
    let reviewIssues: string[] = [];

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const letter = await callGemini(env, model, buildUserPrompt(order, reviewIssues));
      const ruleReview = reviewLetterWithRules(letter);
      const aiReview = await reviewWithAi(env, letter);
      const allIssues = [...ruleReview.issues, ...aiReview.issues];

      if (ruleReview.ok && aiReview.ok) {
        await completeGeneration(env, order.id, letter);
        if (order.subscription_id) {
          await commitReservedQuota(env, order.subscription_id);
        }
        logEvent("ai_generation_completed", { orderId: order.id });
        return;
      }

      reviewIssues = allIssues;
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
