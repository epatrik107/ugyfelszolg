import { afterEach, describe, expect, it, vi } from "vitest";
import { checkAiServiceAvailable } from "../src/lib/health";
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_PREMIUM_MODEL,
  getGenerationModel,
  getReviewModel,
} from "../src/lib/geminiModels";
import type { Env } from "../src/lib/types";

const env = {
  GEMINI_API_KEY: "test-key",
} as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Gemini service availability", () => {
  it("replaces incompatible model names previously written by the deploy workflow", () => {
    const legacyEnv = {
      GEMINI_MODEL: "gemini-2.5-flash-lite",
      GEMINI_MODEL_PREMIUM: "gemini-3.5-flash",
      GEMINI_REVIEW_MODEL: "gemini-3.1-flash-lite",
    } as Env;

    expect(getGenerationModel(legacyEnv, false)).toBe(DEFAULT_GEMINI_MODEL);
    expect(getGenerationModel(legacyEnv, true)).toBe(DEFAULT_GEMINI_PREMIUM_MODEL);
    expect(getReviewModel(legacyEnv)).toBe(DEFAULT_GEMINI_MODEL);
  });

  it("checks the exact default model instead of accepting a models-list response", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    await expect(checkAiServiceAvailable(env)).resolves.toBe(true);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toContain(`/models/${DEFAULT_GEMINI_MODEL}?`);
  });

  it("returns false when the configured generation model does not exist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
    );

    await expect(
      checkAiServiceAvailable({
        ...env,
        GEMINI_MODEL: "gemini-does-not-exist",
      }),
    ).resolves.toBe(false);
  });

  it("checks both premium generation and review models for premium orders", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    await expect(checkAiServiceAvailable(env, true)).resolves.toBe(true);

    const urls = fetch.mock.calls.map(([url]) => String(url));
    expect(urls).toHaveLength(2);
    expect(urls.some((url) => url.includes(`/models/${DEFAULT_GEMINI_PREMIUM_MODEL}?`))).toBe(true);
    expect(urls.some((url) => url.includes(`/models/${DEFAULT_GEMINI_MODEL}?`))).toBe(true);
  });
});
