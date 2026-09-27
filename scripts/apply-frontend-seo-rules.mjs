import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const policy = JSON.parse(await readFile(new URL('../infra/frontend-security.json', import.meta.url), 'utf8'));
const token = process.env.CLOUDFLARE_API_TOKEN;
assert.ok(token, 'CLOUDFLARE_API_TOKEN is required');
const base = `https://api.cloudflare.com/client/v4/zones/${policy.zoneId}`;
async function api(path, method = 'GET', body) {
  const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type':'application/json' }, body: body ? JSON.stringify(body) : undefined, signal:AbortSignal.timeout(30000) });
  const data = await response.json();
  if (!data.success) {
    if (method === 'GET' && response.status === 404) return null;
    throw new Error(`Cloudflare ${method} ${path}: HTTP ${response.status}, ${JSON.stringify(data.errors?.map(({code,message})=>({code,message})))}`);
  }
  return data.result;
}
for (const [phase, rules] of Object.entries(policy.seoRules)) {
  let entry = await api(`/rulesets/phases/${phase}/entrypoint`);
  if (!entry) {
    entry = await api('/rulesets','POST',{name:`Levélsegéd ${phase}`,kind:'zone',phase,rules});
    console.log(`Created ${phase} with ${rules.length} SEO rules.`);
    continue;
  }
  for (const rule of rules) {
    const existing = entry.rules.find((item)=>item.ref===rule.ref);
    if (existing) await api(`/rulesets/${entry.id}/rules/${existing.id}`,'PATCH',rule);
    else await api(`/rulesets/${entry.id}/rules`,'POST',rule);
    console.log(`Applied ${rule.ref}; unrelated rules preserved.`);
  }
}
