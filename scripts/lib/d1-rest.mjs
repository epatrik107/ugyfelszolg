// Minimal Cloudflare D1 REST client for CI and operator workflows.
// Queries are always parameterized; callers never interpolate input into SQL.
export function d1Client({
  accountId = process.env.CLOUDFLARE_ACCOUNT_ID,
  databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID,
  apiToken = process.env.CLOUDFLARE_API_TOKEN,
  fetchImpl = fetch,
} = {}) {
  if (!accountId || !databaseId || !apiToken) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID and CLOUDFLARE_API_TOKEN are required.");
  }
  return async function query(sql, params = []) {
    const response = await fetchImpl(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ sql, params }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success || !payload.result?.every((result) => result.success)) {
      throw new Error(`D1 query failed (HTTP ${response.status}).`);
    }
    return payload.result[0].results;
  };
}
