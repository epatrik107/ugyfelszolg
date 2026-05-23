export interface RuleReviewResult {
  ok: boolean;
  issues: string[];
  /** Issues that block generation and trigger a retry. */
  blockers: string[];
  /** Issues worth logging but that do not block generation. */
  warnings: string[];
}

/** Patterns that BLOCK generation — must be absent before we can proceed. */
const blockerPatterns: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /biztosan pert nyer/i, label: "Biztos peres eredmény állítása." },
  { pattern: /garantáltan nyer/i, label: "Garantált eredmény ígérete." },
  { pattern: /jogi következmény biztos/i, label: "Biztos jogi következmény állítása." },
  { pattern: /azonnal perelje be/i, label: "Azonnali perindításra felszólítás." },
  { pattern: /egészségügyi tanács/i, label: "Egészségügyi tanácsadás." },
  { pattern: /pénzügyi tanács/i, label: "Pénzügyi tanácsadás." },
  // Expanded blocker patterns
  { pattern: /bűncselekményt követ(ett)? el/i, label: "Konkrét bűncselekmény-minősítés." },
  { pattern: /jogsértés(t követ(ett)? el)?/i, label: "Konkrét jogsértés-megállapítás." },
  { pattern: /kötelező(en)? meg kell téríten/i, label: "Kötelező kártérítés állítása." },
  { pattern: /bírságot (fog |kap|kapnak|fizetnek)/i, label: "Bírság biztos bekövetkezése." },
  { pattern: /hatóság(hoz fordul|nak jelent)/i, label: "Hatósági feljelentés jogi tanácsként." },
  { pattern: /GDPR szerint (kötelez|per|bírság)/i, label: "Jogszabályi következmény megállapítása." },
  { pattern: /feljelentést (tesz|teszek|teszünk|fog)/i, label: "Feljelentés jogi tanácsként." },
];

/** Patterns that generate WARNINGS — logged but do not block generation. */
const warningPatterns: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /megsemmisít/i, label: "Agresszív megfogalmazás: 'megsemmisít'." },
  { pattern: /tönkretesz/i, label: "Agresszív megfogalmazás: 'tönkretesz'." },
  { pattern: /fenyeget/i, label: "Fenyegető megfogalmazás." },
  { pattern: /bosszú/i, label: "Bosszú-utalás." },
  // Expanded warning patterns
  { pattern: /súlyos következménye(i)? lesz(nek)?/i, label: "Fenyegetőző hangnem: súlyos következmény." },
  { pattern: /nem (fog|fogják) ú?szon ni/i, label: "Fenyegetőző megfogalmazás." },
  { pattern: /nyilvánosságra hoz(om|zuk|za)?/i, label: "Nyilvánosságra hozatal fenyegetése." },
  { pattern: /sajtónak (ad(om|juk)|el(mondom|mesélem|mesélj))/i, label: "Sajtóval való fenyegetés." },
  { pattern: /ügyvéd(et fogad|hez fordul|hez megy)/i, label: "Ügyvédi lépés fenyegetésként megfogalmazva." },
];

export function reviewLetterWithRules(letter: string): RuleReviewResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!/t[aá]rgy/i.test(letter)) {
    blockers.push("Hiányzik a tárgy.");
  }
  if (!/(Tisztelt|Kedves)\s+/i.test(letter)) {
    blockers.push("Hiányzik a megszólítás.");
  }
  if (!/(kér(em|jük|ném|ésem|ésünk|i|lek|dek)?|kéréssel fordulok|szeretném kérni)/i.test(letter)) {
    blockers.push("Nem elég világos a kérés.");
  }
  if (!/(Tisztelettel|Üdvözlettel|Köszönettel|köszönöm|Előre is köszön)/i.test(letter)) {
    blockers.push("Hiányzik az udvarias lezárás.");
  }
  if (!/[áéíóöőúüű]/i.test(letter)) {
    blockers.push("A levél nem tűnik magyar nyelvűnek.");
  }

  for (const { pattern, label } of blockerPatterns) {
    if (pattern.test(letter)) {
      blockers.push(label);
    }
  }

  for (const { pattern, label } of warningPatterns) {
    if (pattern.test(letter)) {
      warnings.push(label);
    }
  }

  const issues = [...blockers, ...warnings];
  return { ok: blockers.length === 0, issues, blockers, warnings };
}
