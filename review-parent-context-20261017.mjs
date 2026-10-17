// Local-only review of PR10632 b6d0456 using the already installed SDK.
// Does not modify the SvelteKit fixture or original reproduction results.
import http from 'node:http';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import net from 'node:net';
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host = first && typeof first === 'object' ? first.host : typeof args[1] === 'string' ? args[1] : undefined;
  if (host && !['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('External connection blocked: ' + host);
  return connect.apply(this, args);
};
const payloads = [];
const collector = http.createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  let body = Buffer.concat(chunks);
  if (request.headers['content-encoding'] === 'gzip') body = zlib.gunzipSync(body);
  if (request.url === '/v1/traces') payloads.push(JSON.parse(body.toString()));
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end('{}');
});
await new Promise(resolve => collector.listen(0, '127.0.0.1', resolve));
process.env.OTEL_NODE_ENABLED_INSTRUMENTATIONS = '';
const endpoint = 'http://127.0.0.1:' + collector.address().port;
process.env.OTEL_EXPORTER_OTLP_ENDPOINT = endpoint;
const { H } = await import('@highlight-run/node');
H.init({ projectID: 'local-review', serviceName: 'parent-review', otlpEndpoint: endpoint, disableConsoleRecording: true });
const original = {
  'x-highlight-request': 'synthetic-session/synthetic-request',
  traceparent: '00-11111111111111111111111111111111-2222222222222222-01',
};
const requestObservations = [];
for (const mode of ['headers', 'empty']) {
  await H.runWithHeaders('request.' + mode, { ...original }, async request => {
    const { span } = H.startWithHeaders('error.' + mode, mode === 'headers' ? { ...original } : {});
    H.consumeError(new Error('synthetic review error'), 'synthetic-session', 'synthetic-request', undefined, { span });
    requestObservations.push({ mode, requestStillRecording: request.isRecording() });
    request.setAttribute('http.response.status_code', 500);
  });
}
await H.flush();
await H.stop();
const spans = payloads.flatMap(payload => payload.resourceSpans.flatMap(resource =>
  (resource.scopeSpans || resource.instrumentationLibrarySpans).flatMap(scope => scope.spans)));
const results = ['headers', 'empty'].map(mode => {
  const request = spans.find(span => span.name === 'request.' + mode);
  const error = spans.find(span => span.name === 'error.' + mode);
  return {
    mode,
    requestSpanId: request.spanId,
    requestParent: request.parentSpanId,
    errorParent: error.parentSpanId,
    errorIsRequestChild: error.parentSpanId === request.spanId,
    errorSharesTrace: error.traceId === request.traceId,
    requestStatus: request.attributes.find(attribute => attribute.key === 'http.response.status_code')?.value,
    exceptionRecorded: error.events.some(event => event.name === 'exception'),
  };
});
assert.equal(results[0].errorIsRequestChild, false);
assert.equal(results[0].errorParent, '2222222222222222');
assert.equal(results[1].errorIsRequestChild, true);
assert.ok(requestObservations.every(observation => observation.requestStillRecording));
assert.ok(results.every(result => result.errorSharesTrace && result.exceptionRecorded && Number(result.requestStatus.intValue) === 500));
console.log(JSON.stringify({
  observedAt: new Date().toISOString(), sdk: '3.12.22',
  scope: 'Isolated installed SDK reproduction; no SvelteKit runtime rerun',
  requestObservations, results,
}, null, 2));
await new Promise(resolve => collector.close(resolve));
process.exit(0);
