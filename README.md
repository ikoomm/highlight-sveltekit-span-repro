# Highlight SvelteKit error-span reproduction

A minimal local reproduction of a correctness issue in [PR10632](https://github.com/highlight/highlight/pull/10632), based on commit `8361e60ada10ec63065f6f851b65f2eafcf19dc1`. Attribution and changes are recorded in NOTICE; the upstream directory's Apache-2.0 license is included.

Prepared and validated with Codex assistance. The recorded checks ran locally; no independent human review is claimed.

## Run

Node used: 24.18.0; npm: 11.16.0.

```sh
git clone https://github.com/ikoomm/highlight-sveltekit-span-repro.git
cd highlight-sveltekit-span-repro
npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org
npm exec svelte-kit sync
npm test
npm run check
```

The lockfile pins the dependency tree. Direct versions include Highlight Node 3.12.22, SvelteKit 2.70.3, Svelte 5.57.2, Vite 8.3.4, adapter-node 5.5.7, TypeScript 6.0.2, svelte-check 4.4.5 and Node types 24.19.2.

## What runs

`run-repro.mjs` starts two separate Node processes. Each uses Vite's real SvelteKit server and a loopback OTLP receiver; it requests the actual `/ok` and `/error` routes. The latter throws a real Error. Neither the SDK nor its span implementation is mocked.

`scenario.mjs` installs either the original or corrected hooks, routes trace/log/metric exporters to the local receiver, and checks that the runner shares the initialized SDK singleton. The TCP guard rejects recognized non-loopback connect targets. This is not an OS egress sandbox. No production credentials are used. Runtime results showed zero guard rejections.

## Observed result

Both modes returned HTTP200 for `/ok` and HTTP500 for `/error`.
The original error request span contained the exception and session ID but lacked method, route and response status. The corrected request span retained all three HTTP attributes. Its dedicated exception span had the same trace ID, the request span's ID as parent, and the session ID.

`verified-summary.json` is the compact result without local paths. Raw per-scenario JSON includes exported span data and local stack paths; `results/` is ignored by Git.

The test deliberately asserts the original defect before checking corrected behavior. Passing means the difference was reproduced, not that the original code passes the desired behavior.

## Scope

Verified SvelteKit 2 dev-server runtime. Adapter-node is configured but production build/deployment is untested; SvelteKit3 is untested. `npm run check` finished with zero errors and one endpoint-only warning (no .svelte inputs). Full Highlight monorepo build and docs rendering were not run.

## Small patch

`candidate.patch` changes only the error reporting call in the original PR's guide: create a dedicated span, then pass it to `H.consumeError`. The helper ends the explicit error span while `H.runWithHeaders` owns the request span lifetime.

This fixture supports a technical review of the existing PR. It makes no bounty claim.

## Follow-up: incoming trace context

PR commit `b6d0456c61eaa400076f99bfcdfe57874736ce98` adopts the dedicated error span and fixes the premature request-span ending. Its error handler passes the original request headers into `H.startWithHeaders`.

The additional SDK-only check isolates the effect of a valid incoming W3C `traceparent`:

```sh
node review-parent-context-20261017.mjs
```

On Highlight Node 3.12.22, passing the original carrier makes the error span a sibling of the active request span under the incoming parent. Passing `{}` keeps the error span a child of the active request. Both retain the same trace ID, the exception, and HTTP status 500; the main lifetime fix still works.

The SDK extracts context from the supplied headers before starting the span. Use `H.startWithHeaders('sveltekit.error', {})` inside the active request context; session identifiers can still be parsed separately from the request headers.

`review-parent-context-20261017.result.json` records the local check at 2026-10-17T03:51:24Z. All identifiers and errors are synthetic; exporters target a loopback receiver. This is an isolated SDK check, not a new SvelteKit, production-adapter, or full documentation-build validation. It does not change the scope of the original runtime results above.
