// Adapted from highlight/highlight PR10632 by dongwei-polyred (Apache-2.0). See NOTICE for source and modifications.
import { building } from '$app/environment'
import { H } from '@highlight-run/node'
import type { Handle, HandleServerError } from '@sveltejs/kit'

// PR10632 example; only SDK destination/console options differ for local-only test.
if (!building) {
  H.init({
    projectID: 'local-reproduction',
    serviceName: 'sveltekit-server',
    serviceVersion: 'git-sha',
    environment: 'production',
    otlpEndpoint: process.env.HIGHLIGHT_OTLP_LOCAL,
    disableConsoleRecording: true,
  })
}

function highlightHeaders(request: Request): Record<string, string> {
  return Object.fromEntries(request.headers)
}

export const handle: Handle = async ({ event, resolve }) => {
  if (building) return resolve(event)
  const route = event.route.id ?? event.url.pathname
  return H.runWithHeaders(
    `${event.request.method} ${route}`,
    highlightHeaders(event.request),
    async (span) => {
      const response = await resolve(event)
      span.setAttribute('http.request.method', event.request.method)
      span.setAttribute('http.route', route)
      span.setAttribute('http.response.status_code', response.status)
      return response
    },
  )
}

export const handleError: HandleServerError = async ({ error, event, status, message }) => {
  if (!building) {
    const { secureSessionId, requestId } = H.parseHeaders(highlightHeaders(event.request))
    H.consumeError(error as Error, secureSessionId, requestId)
  }
  return { message }
}
