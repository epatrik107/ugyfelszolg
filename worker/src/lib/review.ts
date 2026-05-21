export interface RuleReviewResult {
  ok: boolean;
  issues: string[];
}

const forbiddenPatterns = [
  /biztosan pert nyer/i,
  /garantáltan nyer/i,
  /jogi következmény biztos/i,
  /azonnal perelje be/i,
  /egészségügyi tanács/i,
  /pénzügyi tanács/i,
];

const aggressivePatterns = [/megsemmisít/i, /tönkretesz/i, /fenyeget/i, /bosszú/i];

export function reviewLetterWithRules(letter: string): RuleReviewResult {
  const issues: string[] = [];

  if (!/^Tárgy:/im.test(letter)) {
    issues.push("Hiányzik a tárgy.");
  }
  if (!/(Tisztelt|Kedves)\s+/i.test(letter)) {
    issues.push("Hiányzik a megszólítás.");
  }
  if (!/(Kérem|kérem|szeretném kérni)/.test(letter)) {
    issues.push("Nem elég világos a kérés.");
  }
  if (!/(Tisztelettel|Üdvözlettel)/i.test(letter)) {
    issues.push("Hiányzik az udvarias lezárás.");
  }
  if (!/[áéíóöőúüű]/i.test(letter)) {
    issues.push("A levél nem tűnik magyar nyelvűnek.");
  }
  if (forbiddenPatterns.some((pattern) => pattern.test(letter))) {
    issues.push("Tiltott jogi vagy pénzügyi állítás szerepel.");
  }
  if (aggressivePatterns.some((pattern) => pattern.test(letter))) {
    issues.push("A levél túl agresszív.");
  }

  return { ok: issues.length === 0, issues };
}
