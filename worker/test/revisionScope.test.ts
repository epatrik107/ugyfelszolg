import { describe, it, expect } from "vitest";
import { reviewRevisionScope } from "../src/lib/revision";
const prefix = "Tárgy: Csomag\n\nTisztelt Webáruház!\n\nKérem az RND-2048 rendelés kézbesítését.\n\n";
const previous = prefix + "Köszönöm segítségüket.\n\nÜdvözlettel:\nTeszt Elek";
const feedback = "Csak a lezárást módosítsd, a többi bekezdés maradjon.";
describe("closing-only revision scope", () => {
  it("accepts a changed closing and normalizes line wrapping", () => {
    expect(reviewRevisionScope(previous, prefix.replaceAll("\n", "\r\n") + "Kérem, válaszoljanak emailben.\nKöszönettel:\nTeszt Elek", feedback)).toEqual([]);
  });
  it.each(["Csomag", "Webáruház", "RND-2048", "kézbesítését"])("rejects rewriting protected text: %s", (text) => {
    expect(reviewRevisionScope(previous, previous.replace(text, "ÁTÍRT"), feedback)).toHaveLength(1);
  });
  it("rejects an inserted introduction or date", () => {
    expect(reviewRevisionScope(previous, "Budapest, 2026. szeptember 13.\n" + previous, feedback)).toHaveLength(1);
  });
  it("does not guess the boundary of an unconventional closing", () => {
    expect(reviewRevisionScope(prefix + "Viszontlátásra!", previous, feedback)).toHaveLength(1);
  });
  it("does not impose closing-only restrictions on other modification requests", () => {
    expect(reviewRevisionScope(previous, "Más megfogalmazás", "Legyen rövidebb.")).toEqual([]);
  });
  it("handles a closing without a separate thank-you paragraph", () => {
    expect(reviewRevisionScope(prefix + "Tisztelettel:\nTeszt Elek", prefix + "Köszönettel:\nTeszt Elek", feedback)).toEqual([]);
  });
});
