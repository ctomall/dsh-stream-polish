/**
 * Authenticated browser routes owned by the Stream polish settings page.
 *
 * They ride the shared `/api` channel registered through Connection, so the
 * Host's browser-trust fence and login cookie already protect every one of
 * them. They take no user input: the plugin directory and remote are fixed at
 * activation, and an upgrade is always a fast-forward of that checkout.
 */

const NO_STORE = { 'cache-control': 'no-store' }

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
 * Build the route table.
 * @param {{ updater: { info: Function, status: Function, apply: Function }, onUpgraded?: (result: object) => object }} options - route dependencies.
 * @returns {Array<object>} routes shaped for `connection.fetch.register`.
 */
export function createRoutes({ updater, onUpgraded }) {
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
  ]
}
