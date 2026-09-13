/** Enforce explicit closing-only edits independently of model judgment. */
export function reviewRevisionScope(previous: string | null, candidate: string, feedback?: string): string[] {
  if (!previous || !feedback || !/(?:csak|kizárólag)\s+(?:az?\s+)?(?:udvarias\s+)?(?:lezárás|zárómondat|befejezés)/iu.test(feedback)) return [];
  const closing = /^(?:(?:Tisztelettel|Üdvözlettel|Köszönettel)\s*[:!,.]?|(?:Előre is )?köszön(?:öm|jük)[^\n]*)\s*$/imu.exec(previous);
  if (!closing || closing.index < 30) return ["A korábbi levél lezárása nem azonosítható biztonságosan a célzott módosításhoz."];
  const normalize = (value: string) => value.replace(/\s+/gu, " ").trim();
  const protectedText = normalize(previous.slice(0, closing.index));
  if (!normalize(candidate).startsWith(protectedText + " ")) {
    return ["Csak a lezárás módosítható: állítsd vissza szó szerint a korábbi levél tárgyát, megszólítását és a lezárás előtti bekezdéseit."];
  }
  return [];
}
