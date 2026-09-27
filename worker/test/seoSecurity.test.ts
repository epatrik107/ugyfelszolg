import { describe, expect, it } from "vitest";
import { addSecurityHeaders } from "../src/lib/security";
describe("API search exclusion", () => {
  for (const status of [200, 302, 400, 401, 404, 500]) it(`protects status ${status} without changing content`, async () => {
    const response = addSecurityHeaders(new Response("test", { status, headers: { "Cache-Control": "no-store" } }));
    expect(response.status).toBe(status);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe("test");
  });
});
