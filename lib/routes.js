/**
 * Authenticated browser routes owned by the Stream polish settings page.
 *
 * They ride the shared `/api` channel registered through Connection, so the
 * Host's browser-trust fence and login cookie already protect every one of
 * them. The upgrade routes take no user input: the plugin directory and remote
 * are fixed at activation, and an upgrade is always a fast-forward of that
 * checkout.
 *
 * `GET /translation` and `POST /translate` are the only routes that accept a
 * body. They forward one bounded reasoning fragment to the optional
 * `translator` service. Every failure is a typed envelope, never a thrown
 * response and never echoed source text, so the browser can keep showing the
 * original reasoning while the agent keeps streaming.
 */

import { TRANSLATION_PROVIDERS } from '../config.js'

const NO_STORE = { 'cache-control': 'no-store' }

/** Language tags accepted by the translator; mirrors `config.js`. */
const LANGUAGE_PATTERN = /^(?:auto|[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*)$/

/** Bounded Session identity supplied by the browser for durable translation reuse. */
const SESSION_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/

/** Fallback request limit when the translator service is not mounted. */
const FALLBACK_MAX_TEXT_CHARS = 4000

/**
 * Build one JSON response.
 * @param {unknown} value - payload.
 * @param {number} [status] - HTTP status.
 * @returns {Response} response.
 */
function json(value, status = 200) {
  return Response.json(value, { status, headers: NO_STORE })
}

/**
 * Map an unexpected failure to one JSON body the page can show verbatim.
 * @param {unknown} error - thrown value.
 * @returns {Response} response.
 */
function failure(error) {
  const message = error instanceof Error ? error.message : String(error)
  return json({ ok: false, error: 'operation-failed', message }, 500)
}

/**
 * Map a translator failure to a stable code the browser can classify.
 *
 * The translator never includes submitted text or provider response bodies in
 * its errors; this mapper keeps that guarantee by returning codes only.
 * @param {unknown} error - rejected value from `translate()`.
 * @returns {string} a stable code.
 */
export function translationFailureCode(error) {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return 'TIMEOUT'
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
  switch (code) {
    case 'TRANSLATION_TEXT_LIMIT': return 'TEXT_LIMIT'
    case 'TRANSLATION_SESSION_INACTIVE': return 'SESSION_INACTIVE'
    case 'TRANSLATION_SESSION_REQUIRED': return 'SESSION_REQUIRED'
    case 'TRANSLATION_TIMEOUT': return 'TIMEOUT'
    case 'TRANSLATION_UNAVAILABLE': return 'UNAVAILABLE'
    case 'TRANSLATION_STORAGE_ERROR': return 'STORAGE_FAILED'
    case 'TRANSLATION_HTTP_FAILURE': return 'PROVIDER_FAILED'
    case 'TRANSLATION_INVALID_RESPONSE': return 'INVALID_RESPONSE'
    case 'TRANSLATION_RESPONSE_LIMIT': return 'RESPONSE_LIMIT'
    case 'TRANSLATION_REQUEST_FAILED': return 'REQUEST_FAILED'
    default: return 'FAILED'
  }
}

/**
 * Build the route table.
 * @param {{
 *   updater: { info: Function, status: Function, apply: Function },
 *   settings: Record<string, unknown>,
 *   translatorOf: () => unknown,
 *   onUpgraded?: (result: object) => object,
 * }} options - route dependencies.
 * @returns {Array<object>} routes shaped for `connection.fetch.register`.
 */
export function createRoutes({
  updater,
  settings = {},
  translatorOf = () => undefined,
  onUpgraded,
}) {
  const translation = () => {
    const service = typeof translatorOf === 'function' ? translatorOf() : undefined
    return service === undefined ? undefined : service
  }

  return [
    {
      path: '/api/stream-polish/info',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => {
        try {
          return json(await updater.info())
        } catch (error) {
          return failure(error)
        }
      },
    },
    {
      path: '/api/stream-polish/update',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => {
        try {
          return json(await updater.status())
        } catch (error) {
          return failure(error)
        }
      },
    },
    {
      path: '/api/stream-polish/update/apply',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async () => {
        try {
          const result = await updater.apply()
          if (result.ok === true && result.changed === true && onUpgraded !== undefined) {
            const extra = onUpgraded(result)
            return json({ ...result, ...(extra ?? {}) })
          }
          return json(result)
        } catch (error) {
          return failure(error)
        }
      },
    },
    {
      path: '/api/stream-polish/translation',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => {
        const service = translation()
        return json({
          ok: true,
          available: service !== undefined,
          maxTextChars: typeof service?.maxTextChars === 'number'
            ? service.maxTextChars
            : FALLBACK_MAX_TEXT_CHARS,
          providers: TRANSLATION_PROVIDERS,
          defaultProvider: settings.translationProvider,
          defaultTargetLanguage: settings.translationTargetLanguage,
          timeoutMs: settings.translationTimeoutMs,
        })
      },
    },
    {
      path: '/api/stream-polish/translate',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        let payload
        try {
          payload = await request.json()
        } catch {
          return json({ ok: false, code: 'BAD_REQUEST', retryable: false }, 400)
        }
        if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
          return json({ ok: false, code: 'BAD_REQUEST', retryable: false }, 400)
        }

        const service = translation()
        if (service === undefined) {
          return json({ ok: false, code: 'UNAVAILABLE', retryable: false })
        }

        const maxTextChars = typeof service.maxTextChars === 'number'
          ? service.maxTextChars
          : FALLBACK_MAX_TEXT_CHARS
        const text = payload.text
        if (typeof text !== 'string' || text.length === 0) {
          return json({ ok: false, code: 'BAD_REQUEST', retryable: false }, 400)
        }
        if (text.length > maxTextChars) {
          return json({ ok: false, code: 'TEXT_LIMIT', retryable: false, maxTextChars })
        }

        const provider = payload.provider ?? settings.translationProvider
        if (!TRANSLATION_PROVIDERS.includes(provider)) {
          return json({ ok: false, code: 'BAD_PROVIDER', retryable: false }, 400)
        }
        const targetLanguage = payload.targetLanguage ?? settings.translationTargetLanguage
        if (typeof targetLanguage !== 'string' || !LANGUAGE_PATTERN.test(targetLanguage)) {
          return json({ ok: false, code: 'BAD_LANGUAGE', retryable: false }, 400)
        }
        const sessionId = payload.sessionId
        if (sessionId !== undefined && (typeof sessionId !== 'string' || !SESSION_PATTERN.test(sessionId))) {
          return json({ ok: false, code: 'BAD_SESSION', retryable: false }, 400)
        }

        try {
          const request_ = {
            text,
            provider,
            targetLanguage,
            ...(sessionId === undefined ? {} : { sessionId }),
          }
          const spec = service.resolve(request_)
          const timeoutMs = Number.isInteger(settings.translationTimeoutMs)
            ? settings.translationTimeoutMs
            : 8000
          const translated = await service.translate(spec, AbortSignal.timeout(timeoutMs))
          return json({ ok: true, text: translated })
        } catch (error) {
          return json({ ok: false, code: translationFailureCode(error), retryable: true })
        }
      },
    },
  ]
}
