import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2];
if (!['original', 'corrected'].includes(mode)) throw new Error('Choose original or corrected');
const blockedExternalConnections = [];
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host = first && typeof first === 'object' ? first.host : typeof args[1] === 'string' ? args[1] : undefined;
  if (host && !['127.0.0.1', 'localhost', '::1'].includes(host)) {
    blockedExternalConnections.push(String(host));
    throw new Error('External runtime network blocked: ' + host);
  }
  return connect.apply(this, args);
};
const received = [];
const collector = http.createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  let body = Buffer.concat(chunks);
  if (request.headers['content-encoding'] === 'gzip') body = zlib.gunzipSync(body);
  if (body.length) received.push({ path: request.url, contentType: request.headers['content-type'], payload: JSON.parse(body.toString()) });
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end('{}');
});
await new Promise(resolve => collector.listen(0, '127.0.0.1', resolve));
process.env.HIGHLIGHT_OTLP_LOCAL = 'http://127.0.0.1:' + collector.address().port;
process.env.OTEL_NODE_ENABLED_INSTRUMENTATIONS = '';
process.env.OTEL_EXPORTER_OTLP_ENDPOINT = process.env.HIGHLIGHT_OTLP_LOCAL;
await fs.copyFile(path.join(root, 'hooks.' + mode + '.ts'), path.join(root, 'src/hooks.server.ts'));
const { createServer } = await import('vite');
const vite = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
await vite.listen();
const address = vite.httpServer.address();
const base = 'http://127.0.0.1:' + address.port;
const responses = [];
for (const route of ['/ok', '/error']) {
  const response = await fetch(base + route, { headers: { 'x-highlight-request': 'local-session/local-request' } });
  responses.push({ path: route, status: response.status, body: await response.text() });
}
const { H } = await import('@highlight-run/node');
assert.equal(H.isInitialized(), true, 'Runner and SvelteKit hooks must share the real SDK singleton');
await H.flush();
await new Promise(resolve => setTimeout(resolve, 500));
await H.stop();
const spans = received.filter(item => item.path === '/v1/traces').flatMap(item =>
  item.payload.resourceSpans.flatMap(resource => (resource.scopeSpans || resource.instrumentationLibrarySpans || []).flatMap(scope => scope.spans))
);
const result = { mode, responses, spans, blockedExternalConnections, sdkInitialized: H.isInitialized(), endpoint: process.env.HIGHLIGHT_OTLP_LOCAL, exportPaths: received.map(item => item.path), node: process.version };
await fs.mkdir(path.join(root, 'results'), { recursive: true });
await fs.writeFile(path.join(root, 'results', mode + '.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ mode, responses: responses.map(({path,status}) => ({path,status})), spans: spans.map(span => ({name:span.name, attributes:span.attributes, eventNames:span.events.map(event => event.name)})), blockedExternalConnections }));
await vite.close();
await new Promise(resolve => collector.close(resolve));
process.exit(0);
