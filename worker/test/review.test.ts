import { describe, it, expect } from "vitest";
import { reviewLetterWithRules } from "../src/lib/review";

// A minimal valid Hungarian official letter used as baseline
const SAFE_LETTER = `Tárgy: Reklamáció – hibás termék visszatérítése

Tisztelt Ügyfélszolgálat!

Kérem, szíveskedjenek a 2025. január 10-én vásárolt, hibás terméket visszavenni
és a vételárat visszatéríteni.

Előre is köszönöm szíves együttműködésüket.

Tisztelettel,
Teszt Felhasználó`;

describe("reviewLetterWithRules — safe letter passes", () => {
  it("accepts a properly structured, safe Hungarian letter", () => {
    const result = reviewLetterWithRules(SAFE_LETTER);
    expect(result.ok).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it("accepts a letter with only warnings but no blockers", () => {
    // Contains aggressive word "fenyeget" (warning) but no blockers
    const letter = SAFE_LETTER + "\n\nEz a helyzet komolyan fenyeget minket.";
    const result = reviewLetterWithRules(letter);
    expect(result.ok).toBe(true); // warnings don't block
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe("reviewLetterWithRules — structural blockers", () => {
  it("blocks a letter missing 'Tárgy'", () => {
    const letter = SAFE_LETTER.replace(/Tárgy:.*\n/, "");
    const result = reviewLetterWithRules(letter);
    expect(result.ok).toBe(false);
    expect(result.blockers.some((b) => b.includes("tárgy"))).toBe(true);
  });

  it("blocks a letter missing salutation", () => {
    const letter = SAFE_LETTER.replace("Tisztelt Ügyfélszolgálat!", "");
    const result = reviewLetterWithRules(letter);
    expect(result.ok).toBe(false);
    expect(result.blockers.some((b) => b.includes("megszólítás"))).toBe(true);
  });

  it("blocks a letter missing a request", () => {
    const letter = SAFE_LETTER
      .replace(/Kérem.*\n/, "\n")
      .replace(/kéréssel fordulok/i, "")
      .replace(/szeretném kérni/i, "");
    const result = reviewLetterWithRules(letter);
    expect(result.ok).toBe(false);
    expect(result.blockers.some((b) => b.includes("kérés"))).toBe(true);
  });

  it("blocks a letter missing polite closing", () => {
    const letter = SAFE_LETTER
      .replace("Előre is köszönöm szíves együttműködésüket.", "")
      .replace("Tisztelettel,", "");
    const result = reviewLetterWithRules(letter);
    expect(result.ok).toBe(false);
    expect(result.blockers.some((b) => b.includes("lezárás"))).toBe(true);
  });

  it("blocks a letter without any Hungarian accented characters", () => {
    const letter = "Targy: Reklamacio\n\nTisztelt Ugyfelszolgalat!\n\nKerem a megoldast.\n\nTisztelettel,\nNev";
    const result = reviewLetterWithRules(letter);
    expect(result.ok).toBe(false);
    expect(result.blockers.some((b) => b.includes("magyar"))).toBe(true);
  });
});

describe("reviewLetterWithRules — unsafe promise blockers", () => {
  const unsafe = [
    "biztosan pert nyer",
    "garantáltan nyer",
    "jogi következmény biztos",
    "azonnal perelje be",
    "egészségügyi tanács",
    "pénzügyi tanács",
    "bűncselekményt követett el",
    "jogsértést követett el",
    "kötelezően meg kell téríteni",
    "bírságot fog kapni",
    "bírságot kapnak",
    "hatóságnak jelent",
    "GDPR szerint bírság",
    "feljelentést tesz",
    "feljelentést teszek",
  ];

  for (const phrase of unsafe) {
    it(`blocks letter containing: "${phrase}"`, () => {
      const letter = SAFE_LETTER + `\n\n${phrase}`;
      const result = reviewLetterWithRules(letter);
      expect(result.ok).toBe(false);
      expect(result.blockers.length).toBeGreaterThan(0);
    });
  }
});

describe("reviewLetterWithRules — aggressive warning patterns", () => {
  const warningPhrases = [
    "megsemmisít",
    "tönkretesz",
    "fenyeget",
    "bosszú",
    "súlyos következménye lesz",
    "nyilvánosságra hozom",
    "sajtónak adom",
    "ügyvédet fogad",
  ];

  for (const phrase of warningPhrases) {
    it(`produces warning (not blocker) for: "${phrase}"`, () => {
      const letter = SAFE_LETTER + `\n\nEz a helyzet: ${phrase}.`;
      const result = reviewLetterWithRules(letter);
      // Warnings don't block
      expect(result.ok).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      // But the issue is still in the issues list
      expect(result.issues.length).toBeGreaterThan(0);
    });
  }
});

describe("reviewLetterWithRules — combined blocker + warning", () => {
  it("blocks when letter has both blocker and warning patterns", () => {
    const letter = SAFE_LETTER +
      "\n\nBiztosan pert nyer és fenyeget mindenkit.";
    const result = reviewLetterWithRules(letter);
    expect(result.ok).toBe(false);
    expect(result.blockers.length).toBeGreaterThan(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
