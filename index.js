/**
 * Stream polish, Host half.
 *
 * Two jobs, both owned by this half:
 *
 *  1. Configuration. The Loader row config is normalized with `./config.js`,
 *     every malformed value is reported at the configured `logLevel`, and the
 *     accepted values are published as a structured index-injection row so the
 *     Client half reads them from `globalThis` before its module factory runs.
 *     Precedence (low to high): built-in defaults -> bundle patch row -> profile
 *     patch override -> this browser's saved overrides -> the
 *     `__DSH_SP_STALL_MS__` test hook.
 *
 *  2. Online upgrade. The bundle lives in a linked git checkout, so the settings
 *     page can ask for a fetch + fast-forward through authenticated `/api`
 *     routes (`./lib/routes.js`, `./lib/update.js`). After the work tree moves,
 *     the Loader recomposes the profile, which replaces the running Host module
 *     from the new files.
 */

import { fileURLToPath } from 'node:url'

import { PACKAGE, DEFAULTS, normalizeConfig } from './config.js'
import { createRoutes } from './lib/routes.js'
import { createUpdater } from './lib/update.js'

/** Global property carrying the resolved config into the browser. */
export const GLOBAL_NAME = '__DSH_STREAM_POLISH__'

/** Wire shape version; the Client half ignores a payload it does not know. */
export const WIRE_VERSION = 2

/** This package's own directory, which is the checkout an upgrade moves. */
export const PACKAGE_DIR = fileURLToPath(new URL('.', import.meta.url))

/** Loader row id; also the id `reconcileProfile` reports on. */
const ROW_ID = 'stream-polish'

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
 * Reload the running Host module from the files an upgrade just checked out.
 *
 * `hmr.reconcileProfile` evicts the changed modules and restarts their Loader
 * entries, so this row picks up the new `index.js` without a process restart.
 * It is scheduled, never awaited: recomposition stops this very entry, and the
 * HTTP response must be able to leave first.
 * @param {{ get?: (name: string) => unknown, logger?: { info?: Function, warn?: Function } }} ctx - plugin context.
 * @returns {{ reload: 'hmr' | 'restart-required' }} what the caller may promise.
 */
function scheduleReload(ctx) {
  const hmr = typeof ctx.get === 'function' ? ctx.get('hmr') : undefined
  if (hmr === undefined || typeof hmr.runExclusive !== 'function') {
    return { reload: 'restart-required' }
  }
  const timer = setTimeout(() => {
    void hmr.runExclusive(() => hmr.reconcileProfile([ROW_ID]))
      .then(() => {
        ctx.logger?.info?.('[' + PACKAGE + '] host module reloaded from the upgraded checkout')
      })
      .catch((error) => {
        ctx.logger?.warn?.('[' + PACKAGE + '] host module reload failed, restart dsh to load it: '
          + (error instanceof Error ? error.message : String(error)))
      })
  }, 600)
  if (typeof timer === 'object' && timer !== null && typeof timer.unref === 'function') timer.unref()
  return { reload: 'hmr' }
}

/**
 * Publish this row's configuration on every index render.
 *
 * `webserver/index-inject` collects JSON rows for the served HTML; a `global`
 * row exists before the later script rows run, so the value is ready when the
 * Client module factory reads it. A deployment without the web carrier simply
 * never emits the event, and the Client half keeps its built-in defaults.
 * @param {object} ctx - plugin context.
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

  // The settings page's upgrade actions. Optional: a profile without Connection
  // simply has no routes and the page reports that the Host half is missing.
  const updater = createUpdater({ packageDir: PACKAGE_DIR, logger: ctx.logger })
  ctx.inject(['connection'], (connectionCtx) => {
    const routes = createRoutes({ updater, onUpgraded: () => scheduleReload(ctx) })
    for (const route of routes) {
      connectionCtx.effect(
        () => connectionCtx.connection.fetch.register(route),
        PACKAGE + ': route ' + route.path,
      )
    }
  })
}

export { normalizeConfig }
