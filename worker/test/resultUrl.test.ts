import { describe, expect, it } from "vitest";
import { buildResultCapabilityUrl } from "../src/lib/resultUrl";

describe("result capability URLs", () => {
  it("keeps the bearer token out of the HTTP query string", () => {
    const result = buildResultCapabilityUrl(
      "https://example.com/base/",
      "sikeres-fizetes",
      "public-1",
      "sensitive-result-token",
    );
    const url = new URL(result);

    expect(url.pathname).toBe("/base/sikeres-fizetes");
    expect(url.searchParams.get("order")).toBe("public-1");
    expect(url.searchParams.get("token")).toBeNull();
    expect(new URLSearchParams(url.hash.slice(1)).get("token")).toBe(
      "sensitive-result-token",
    );
  });
});
