/**
 * Configuration contract for the Stream polish bundle (`@local/stream-polish`).
 *
 * One authority for every option. The Client half is a plain script and cannot
 * import ESM, so it mirrors this table; `test/client.test.mjs` asserts the
 * mirror is identical to `SPEC` below, which is what keeps the two sides from
 * drifting. The Host half normalizes the Loader row config here and publishes
 * the accepted values through `webserver/index-inject`, so the browser never
 * re-guesses a default.
 *
 * Policy: a malformed value never breaks the page. Each bad key produces one
 * explicit message naming the key and the expected value, and the option falls
 * back to its default. Unknown keys are reported and ignored.
 */

/** Package name used in log prefixes and issue text. */
export const PACKAGE = '@local/stream-polish'

/** Diagnostic levels, quiet to loud. `silent` suppresses every plugin log. */
export const LOG_LEVELS = ['silent', 'error', 'warn', 'info', 'debug']

/**
 * Every accepted option, in documentation order.
 *
 * `type` is `boolean` | `integer` | `enum`; `integer` options carry an
 * inclusive `min`/`max`, `enum` options carry their `values`. `default` is the
 * behavior of the previous release, so an empty config reproduces it exactly.
 */
export const SPEC = {
  enabled: {
    type: 'boolean',
    default: true,
    summary: '总开关：false 时不挂样式、不挂观察器、不显示运行胶囊',
  },
  blockFade: {
    type: 'boolean',
    default: true,
    summary: '流式期间新出现的 Markdown 块是否淡入',
  },
  blockFadeMs: {
    type: 'integer',
    default: 160,
    min: 80,
    max: 600,
    summary: '块淡入时长（毫秒）',
  },
  caret: {
    type: 'boolean',
    default: true,
    summary: '是否在正在书写的末尾显示呼吸光标',
  },
  caretPeriodMs: {
    type: 'integer',
    default: 1200,
    min: 400,
    max: 4000,
    summary: '光标一次呼吸的周期（毫秒）',
  },
  settleFade: {
    type: 'boolean',
    default: true,
    summary: '回复落定时光标是否淡出（false 则直接消失）',
  },
  settleMs: {
    type: 'integer',
    default: 260,
    min: 100,
    max: 1000,
    summary: '落定淡出时长（毫秒）；清理定时器取该值加 80ms',
  },
  stallMs: {
    type: 'integer',
    default: 15000,
    min: 500,
    max: 600000,
    summary: '多久没有新输出就显示「无新输出」（毫秒）',
  },
  runStrip: {
    type: 'boolean',
    default: true,
    summary: '是否在输入框上方显示运行胶囊',
  },
  showElapsed: {
    type: 'boolean',
    default: true,
    summary: '胶囊是否显示当前阶段已用时长',
  },
  showActivity: {
    type: 'boolean',
    default: true,
    summary: '胶囊是否显示最近活动 / 停滞文案',
  },
  logLevel: {
    type: 'enum',
    default: 'warn',
    values: LOG_LEVELS,
    summary: '本插件日志级别：silent | error | warn | info | debug',
  },
}

/** Accepted defaults, derived from `SPEC` so the two can never disagree. */
export const DEFAULTS = Object.freeze(
  Object.fromEntries(Object.entries(SPEC).map(([key, rule]) => [key, rule.default])),
)

/** Option names in documentation order. */
export const KEYS = Object.freeze(Object.keys(SPEC))

/**
 * Read the rule for one option.
 * @param {string} key - option name.
 * @returns {{ type: string, default: unknown, min?: number, max?: number, values?: readonly string[], summary: string } | undefined} the rule.
 */
function ruleFor(key) {
  return Object.prototype.hasOwnProperty.call(SPEC, key) ? SPEC[key] : undefined
}

/**
 * Describe what a key accepts, for error text and documentation.
 * @param {string} key - option name.
 * @returns {string} a human-readable expectation.
 */
export function expectationOf(key) {
  const rule = ruleFor(key)
  if (rule === undefined) return 'a known option'
  if (rule.type === 'boolean') return 'a boolean (true or false)'
  if (rule.type === 'integer') return 'an integer between ' + rule.min + ' and ' + rule.max
  return 'one of ' + (rule.values ?? []).map((value) => '"' + value + '"').join(' | ')
}

/**
 * Render a received value the way it appears in an error message.
 * @param {unknown} value - value from the row config.
 * @returns {string} quoted strings, bare numbers, JSON for objects.
 */
export function showValue(value) {
  if (typeof value === 'string') return "'" + value + "'"
  if (value === null) return 'null'
  if (typeof value === 'object') {
    try {
      const json = JSON.stringify(value)
      if (typeof json === 'string') return json
    } catch {
      // A circular or exotic value still needs a readable form.
    }
    return String(value)
  }
  return String(value)
}

/**
 * Accept one value only when it matches the option's rule.
 * @param {string} key - option name.
 * @param {unknown} value - candidate value.
 * @returns {boolean} true when the value can be used as-is.
 */
export function isValid(key, value) {
  const rule = ruleFor(key)
  if (rule === undefined) return false
  if (rule.type === 'boolean') return typeof value === 'boolean'
  if (rule.type === 'integer') {
    return Number.isInteger(value) && value >= rule.min && value <= rule.max
  }
  return typeof value === 'string' && (rule.values ?? []).includes(value)
}

/**
 * Build the one message a rejected value produces.
 *
 * The text always names the option and its expectation, e.g.
 * `config.stallMs must be an integer between 500 and 600000; got 'fast'; using 15000.`
 * @param {string} key - option name.
 * @param {unknown} value - the rejected value.
 * @returns {string} the message, without the log prefix.
 */
export function issueMessage(key, value) {
  const rule = ruleFor(key)
  if (rule === undefined) return 'config.' + key + ' is not a recognized option (ignored).'
  return 'config.' + key + ' must be ' + expectationOf(key) + '; got ' + showValue(value)
    + '; using ' + showValue(rule.default) + '.'
}

/**
 * Normalize a raw Loader row config into every option, collecting issues.
 *
 * Missing keys take the default; a malformed key keeps its default and adds an
 * issue; unknown keys are dropped with an issue. `undefined` or `null` means
 * "no config", which reproduces the previous release exactly.
 * @param {unknown} raw - raw `config` from the Loader row.
 * @returns {{ config: Record<string, unknown>, issues: Array<{ key: string, severity: 'warn', message: string }> }} the normalized config and its issues.
 */
export function normalizeConfig(raw) {
  /** @type {Array<{ key: string, severity: 'warn', message: string }>} */
  const issues = []
  const config = {}
  for (const [key, rule] of Object.entries(SPEC)) config[key] = rule.default

  if (raw === undefined || raw === null) return { config, issues }

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    issues.push({
      key: '',
      severity: 'warn',
      message: 'config must be a mapping of option names to values; got ' + showValue(raw)
        + '; using the built-in defaults.',
    })
    return { config, issues }
  }

  for (const [key, value] of Object.entries(raw)) {
    if (ruleFor(key) === undefined) {
      issues.push({ key, severity: 'warn', message: issueMessage(key, value) })
      continue
    }
    if (isValid(key, value)) {
      config[key] = value
      continue
    }
    issues.push({ key, severity: 'warn', message: issueMessage(key, value) })
  }

  return { config, issues }
}
