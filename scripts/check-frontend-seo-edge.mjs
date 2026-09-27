import assert from 'node:assert/strict';
const origin = 'https://levelseged.hu';
for (const path of ['/sikeres-fizetes','/sikertelen-fizetes','/rendeles-link','/nemletezo-seo-edge']) {
  const response = await fetch(origin+path, {signal:AbortSignal.timeout(10000)});
  assert.match(response.headers.get('x-robots-tag') || '', /noindex/, `${path}: missing X-Robots-Tag`);
}
for (const [path,target] of [['/index.html','/'],['/arak/','/arak'],['/arak.html','/arak']]) {
  const response = await fetch(origin+path+'?verify=seo', {redirect:'manual',signal:AbortSignal.timeout(10000)});
  assert.equal(response.status,301,`${path}: missing 301`);
  assert.equal(response.headers.get('location'),origin+target+'?verify=seo',`${path}: incorrect destination or query lost`);
}
console.log('SEO edge headers and canonical redirects verified.');
