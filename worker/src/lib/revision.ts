function isClosingOnly(previous: string | null, feedback?: string) {
  return Boolean(previous && feedback && /(?:csak|kizárólag)\s+(?:az?\s+)?(?:udvarias\s+)?(?:lezárás|zárómondat|befejezés)/iu.test(feedback));
}

/** Use the same explicit boundary in model context and independent validation. */
export function getProtectedRevisionPrefix(previous: string | null, feedback?: string): string | null {
  if (!previous || !isClosingOnly(previous, feedback)) return null;
  const closing = /^(?:(?:Tisztelettel|Üdvözlettel|Köszönettel)\s*[:!,.]?|(?:Előre is )?köszön(?:öm|jük)[^\n]*)\s*$/imu.exec(previous);
  return closing && closing.index >= 30 ? previous.slice(0, closing.index) : null;
}

/** Enforce explicit closing-only edits independently of model judgment. */
export function reviewRevisionScope(previous: string | null, candidate: string, feedback?: string): string[] {
  if (!isClosingOnly(previous, feedback)) return [];
  const prefix = getProtectedRevisionPrefix(previous, feedback);
  if (prefix === null) return ["A korábbi levél lezárása nem azonosítható biztonságosan a célzott módosításhoz."];
  const normalize = (value: string) => value.replace(/\s+/gu, " ").trim();
  const protectedText = normalize(prefix);
  if (!normalize(candidate).startsWith(protectedText + " ")) {
    return ["Csak a lezárás módosítható: állítsd vissza szó szerint a korábbi levél tárgyát, megszólítását és a lezárás előtti bekezdéseit."];
  }
  return [];
}
