import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
for (const mode of ['original', 'corrected']) {
  const run = spawnSync(process.execPath, ['scenario.mjs', mode], { cwd: process.cwd(), encoding: 'utf8', timeout: 90000 });
  process.stdout.write(run.stdout || '');
  process.stderr.write(run.stderr || '');
  if (run.status !== 0) throw new Error(mode + ' run failed: ' + run.status + ' ' + (run.error || ''));
}
const original = JSON.parse(await fs.readFile('results/original.json'));
const corrected = JSON.parse(await fs.readFile('results/corrected.json'));
const attrs = span => Object.fromEntries(span.attributes.map(a => [a.key, a.value.stringValue ?? Number(a.value.intValue ?? a.value.doubleValue)]));
const requestSpan = result => result.spans.find(span => span.name === 'GET /error');
for (const result of [original, corrected]) {
  assert.equal(result.responses.find(r => r.path === '/error').status, 500);
  assert.equal(result.responses.find(r => r.path === '/ok').status, 200);
  assert.equal(result.blockedExternalConnections.length, 0);
  const ok = result.spans.find(span => span.name === 'GET /ok');
  assert.equal(attrs(ok)['http.response.status_code'], 200);
}
assert.ok(requestSpan(original), 'Original failure still exports a request span');
assert.ok(requestSpan(original).events.some(event => event.name === 'exception' && event.attributes.some(attribute => attribute.key === 'exception.message' && attribute.value.stringValue === 'sample SvelteKit server error')), 'Original request span carries the actual route exception');
assert.ok(requestSpan(corrected), 'Corrected failure exports a request span');
const before = attrs(requestSpan(original));
const after = attrs(requestSpan(corrected));
assert.equal(before['http.response.status_code'], undefined, 'Original error request loses HTTP status metadata');
assert.equal(after['http.response.status_code'], 500, 'Corrected error request retains HTTP status');
assert.equal(after['http.request.method'], 'GET');
assert.equal(after['http.route'], '/error');
assert.equal(after['highlight.session_id'], 'local-session');
const errorSpan = corrected.spans.find(span => span.name === 'sveltekit.error');
assert.ok(errorSpan?.events?.some(event => event.name === 'exception' && event.attributes.some(attribute => attribute.key === 'exception.message' && attribute.value.stringValue === 'sample SvelteKit server error')), 'Dedicated error span carries the actual route exception');
assert.equal(errorSpan.traceId, requestSpan(corrected).traceId, 'Error shares request trace');
assert.equal(errorSpan.parentSpanId, requestSpan(corrected).spanId, 'Error is child of request');
assert.equal(attrs(errorSpan)['highlight.session_id'], 'local-session');
const summary = { reproduced: true, originalErrorRequestAttributes: before, correctedErrorRequestAttributes: after, dedicatedErrorChildVerified: true, realSvelteKitRoutes: true, tcpGuardRejectedExternalConnections: 0, telemetryEndpointScope: 'Loopback only; not an OS-level egress sandbox' };
await fs.writeFile('results/summary.json', JSON.stringify(summary, null, 2));
const packageInfo = JSON.parse(await fs.readFile('package.json'));
await fs.writeFile('verified-summary.json', JSON.stringify({ observedAt: new Date().toISOString(), node: process.version, sdk: packageInfo.dependencies['@highlight-run/node'], svelteKit: packageInfo.dependencies['@sveltejs/kit'], runtime: 'Vite dev server; not production adapter', ...summary }, null, 2));
console.log(JSON.stringify(summary, null, 2));
