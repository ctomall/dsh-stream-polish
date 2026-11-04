/**
 * Stream polish, Host half.
 *
 * Pure UI plugin: no service, no session data. This half owns exactly one
 * thing — the row's configuration. It normalizes the Loader row config with
 * `./config.js`, reports every malformed value at the configured `logLevel`,
 * and publishes the accepted values as a structured index-injection row so the
 * Client half reads them from `globalThis` before its module factory runs.
 *
 * Precedence (low to high): built-in defaults -> bundle patch row -> profile
 * patch override -> this browser's saved overrides -> the `__DSH_SP_STALL_MS__`
 * test hook. The Host only ever sees the first three; the Client half applies
 * the rest.
 */

import { PACKAGE, DEFAULTS, normalizeConfig } from './config.js'

/** Global property carrying the resolved config into the browser. */
export const GLOBAL_NAME = '__DSH_STREAM_POLISH__'

/** Wire shape version; the Client half ignores a payload it does not know. */
export const WIRE_VERSION = 2

/** Rank of each diagnostic level, quiet to loud. */
const LEVEL_RANK = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 }

/**
 * Emit the configured amount of diagnostics for one row activation.
 *
 * With the default `warn` level a valid config logs nothing, so the previous
 * release's quiet startup is unchanged; only a malformed key speaks up.
 * @param {Record<string, unknown>} settings - normalized config.
 * @param {Array<{ key: string, severity: string, message: string }>} issues - collected issues.
 */
function report(settings, issues) {
  const rank = LEVEL_RANK[settings.logLevel] ?? LEVEL_RANK.warn
  if (rank >= LEVEL_RANK.warn) {
    for (const issue of issues) {
      console.warn('[' + PACKAGE + '] ' + issue.message)
    }
  }
  if (rank >= LEVEL_RANK.info) {
    console.info('[' + PACKAGE + '] configuration accepted'
      + (issues.length === 0 ? '' : ' with ' + issues.length + ' issue(s)'))
  }
  if (rank >= LEVEL_RANK.debug) {
    console.debug('[' + PACKAGE + '] resolved config ' + JSON.stringify(settings))
  }
}

/**
 * Publish this row's configuration on every index render.
 *
 * `webserver/index-inject` collects JSON rows for the served HTML; a `global`
 * row exists before the later script rows run, so the value is ready when the
 * Client module factory reads it. A deployment without the web carrier simply
 * never emits the event, and the Client half keeps its built-in defaults.
 * @param {{ on: (event: string, listener: (table: object[]) => void) => unknown }} ctx - plugin context.
 * @param {unknown} config - Loader row config.
 */
export function apply(ctx, config) {
  const { config: settings, issues } = normalizeConfig(config)
  report(settings, issues)

  ctx.on('webserver/index-inject', (table) => {
    table.push({
      kind: 'global',
      name: GLOBAL_NAME,
      value: {
        version: WIRE_VERSION,
        config: settings,
        defaults: DEFAULTS,
        issues,
      },
    })
  })
}

export { normalizeConfig }
