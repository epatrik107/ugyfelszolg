import { describe, expect, it } from "vitest";
import {
  getRemainingRegenerationMessage,
  getRemainingRegenerations,
} from "../../frontend/src/lib/regeneration";

describe("remaining regeneration display", () => {
  it("shows 3 remaining options after first generated email", () => {
    expect(getRemainingRegenerations(1, 3)).toBe(3);
    expect(getRemainingRegenerationMessage(3)).toBe("Még 3 módosítási lehetőséged van.");
  });

  it("shows singular message when one option is left", () => {
    expect(getRemainingRegenerations(3, 3)).toBe(1);
    expect(getRemainingRegenerationMessage(1)).toBe("Még 1 módosítási lehetőséged van.");
  });

  it("shows limit reached message after max attempts", () => {
    expect(getRemainingRegenerations(4, 3)).toBe(0);
    expect(getRemainingRegenerationMessage(0)).toBe(
      "Elérted a módosítási lehetőségek (3) limitjét.",
    );
  });

  it("uses the Basic package limit instead of advertising Premium retries", () => {
    expect(getRemainingRegenerations(1, 1)).toBe(1);
    expect(getRemainingRegenerationMessage(0, 1)).toBe(
      "Elérted a módosítási lehetőségek (1) limitjét.",
    );
  });
});
