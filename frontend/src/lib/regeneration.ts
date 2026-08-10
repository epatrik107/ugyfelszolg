export function getRemainingRegenerations(
  generationCount: number,
  maxRegenerations: number,
) {
  return Math.max(0, maxRegenerations - Math.max(0, generationCount - 1));
}

export function getRemainingRegenerationMessage(
  remainingRegenerations: number,
  maxRegenerations = 3,
) {
  if (remainingRegenerations > 1) {
    return `Még ${remainingRegenerations} módosítási lehetőséged van.`;
  }
  if (remainingRegenerations === 1) {
    return "Még 1 módosítási lehetőséged van.";
  }
  return `Elérted a módosítási lehetőségek (${maxRegenerations}) limitjét.`;
}
