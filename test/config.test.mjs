// Host-side contract tests for `config.js`: defaults, legal values, illegal
// values, boundaries, and the documentation promise.
//
//   node --test test/config.test.mjs
//
// No dependency is added: this uses the Node test runner and the module under
// test directly.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  DEFAULTS,
  KEYS,
  LOG_LEVELS,
  SPEC,
  expectationOf,
  isValid,
  issueMessage,
  normalizeConfig,
} from '../config.js'

/** Values that must reproduce the 1.0.0 behavior exactly. */
const BEHAVIOR_DEFAULTS = {
  enabled: true,
  blockFade: true,
  blockFadeMs: 160,
  caret: true,
  caretPeriodMs: 1200,
  settleFade: true,
  settleMs: 260,
  stallMs: 15000,
  runStrip: true,
  showElapsed: true,
  showActivity: true,
  logLevel: 'warn',
}

test('empty config reproduces the previous release exactly', () => {
  assert.deepEqual(DEFAULTS, BEHAVIOR_DEFAULTS)
  for (const raw of [undefined, null, {}]) {
    const { config, issues } = normalizeConfig(raw)
    assert.deepEqual(config, BEHAVIOR_DEFAULTS, `config for ${String(raw)}`)
    assert.deepEqual(issues, [], `issues for ${String(raw)}`)
  }
})

test('every option has a rule, a default, and a documented summary', () => {
  assert.deepEqual(KEYS, Object.keys(BEHAVIOR_DEFAULTS))
  for (const key of KEYS) {
    const rule = SPEC[key]
    assert.ok(rule, key)
    assert.ok(['boolean', 'integer', 'enum'].includes(rule.type), key + ' type')
    assert.equal(typeof rule.summary, 'string')
    assert.ok(rule.summary.length > 0, key + ' summary')
    if (rule.type === 'integer') {
      assert.ok(Number.isInteger(rule.min) && Number.isInteger(rule.max), key + ' bounds')
      assert.ok(rule.min < rule.max, key + ' ordered bounds')
      assert.ok(Number.isInteger(rule.default), key + ' integer default')
      assert.ok(rule.default >= rule.min && rule.default <= rule.max, key + ' default in range')
    }
    if (rule.type === 'enum') {
      assert.ok(Array.isArray(rule.values) && rule.values.includes(rule.default), key + ' enum default')
    }
    if (rule.type === 'boolean') {
      assert.equal(typeof rule.default, 'boolean', key + ' boolean default')
    }
  }
})

test('legal values are accepted for every option', () => {
  for (const key of KEYS) {
    const rule = SPEC[key]
    const accepted = rule.type === 'boolean'
      ? [true, false]
      : rule.type === 'enum'
        ? [...rule.values]
        : [rule.min, rule.default, rule.max]
    for (const value of accepted) {
      assert.equal(isValid(key, value), true, `${key}=${String(value)} should be legal`)
      const { config, issues } = normalizeConfig({ [key]: value })
      assert.equal(config[key], value, `${key}=${String(value)} should be kept`)
      assert.deepEqual(issues, [], `${key}=${String(value)} should not report`)
    }
  }
})

test('boundaries are inclusive and their neighbours rejected', () => {
  for (const key of KEYS) {
    const rule = SPEC[key]
    if (rule.type !== 'integer') continue
    for (const value of [rule.min, rule.max]) {
      assert.equal(isValid(key, value), true, `${key}=${value} is inside the range`)
    }
    for (const value of [rule.min - 1, rule.max + 1]) {
      assert.equal(isValid(key, value), false, `${key}=${value} is outside the range`)
    }
    for (const value of [rule.default + 0.5, String(rule.default), NaN, null]) {
      assert.equal(isValid(key, value), false, `${key}=${String(value)} is not an integer`)
    }
  }
})

test('illegal values keep the default and name the option and expectation', () => {
  const illegal = {
    enabled: 'yes',
    blockFade: 0,
    blockFadeMs: 700,
    caret: null,
    caretPeriodMs: 100,
    settleFade: 'on',
    settleMs: 5000,
    stallMs: 'fast',
    runStrip: 1,
    showElapsed: {},
    showActivity: [],
    logLevel: 'verbose',
  }
  for (const key of KEYS) {
    const value = illegal[key]
    assert.equal(isValid(key, value), false, `${key} should reject ${JSON.stringify(value)}`)
    const { config, issues } = normalizeConfig({ [key]: value })
    assert.equal(config[key], DEFAULTS[key], `${key} falls back to its default`)
    assert.equal(issues.length, 1, `${key} reports exactly one issue`)
    const [issue] = issues
    assert.equal(issue.key, key)
    assert.equal(issue.severity, 'warn')
    assert.match(issue.message, new RegExp('config\\.' + key + '\\b'), `${key} names the option`)
    assert.ok(issue.message.includes(expectationOf(key)), `${key} states the expectation`)
    assert.equal(issue.message, issueMessage(key, value))
  }
})

test('the expectation text is specific per type', () => {
  assert.equal(expectationOf('stallMs'), 'an integer between 500 and 600000')
  assert.equal(expectationOf('enabled'), 'a boolean (true or false)')
  assert.equal(expectationOf('logLevel'), 'one of "silent" | "error" | "warn" | "info" | "debug"')
  assert.equal(expectationOf('nope'), 'a known option')
})

test('a rejected value produces one stable, quotable message', () => {
  assert.equal(
    issueMessage('stallMs', 'fast'),
    "config.stallMs must be an integer between 500 and 600000; got 'fast'; using 15000.",
  )
  assert.equal(
    issueMessage('logLevel', 'verbose'),
    'config.logLevel must be one of "silent" | "error" | "warn" | "info" | "debug"; got \'verbose\'; using \'warn\'.',
  )
})

test('unknown keys are reported and ignored', () => {
  const { config, issues } = normalizeConfig({ stallMs: 4000, typoKey: 1 })
  assert.equal(config.stallMs, 4000)
  assert.equal('typoKey' in config, false)
  assert.equal(issues.length, 1)
  assert.equal(issues[0].key, 'typoKey')
  assert.match(issues[0].message, /not a recognized option/)
})

test('a non-mapping config is reported once and falls back entirely', () => {
  for (const raw of [42, 'stallMs=800', [1, 2], true]) {
    const { config, issues } = normalizeConfig(raw)
    assert.deepEqual(config, BEHAVIOR_DEFAULTS, String(raw))
    assert.equal(issues.length, 1, String(raw))
    assert.match(issues[0].message, /must be a mapping of option names to values/)
  }
})

test('normalization never throws on odd input', () => {
  const odd = [Symbol('x'), () => {}, new Date(0), {}, { stallMs: undefined }, { stallMs: NaN }]
  for (const raw of odd) {
    assert.doesNotThrow(() => normalizeConfig(raw))
  }
  const symbol = normalizeConfig({ stallMs: Symbol('x') })
  assert.equal(symbol.config.stallMs, DEFAULTS.stallMs)
  assert.equal(symbol.issues.length, 1)
})

test('partial config only overrides the keys it names', () => {
  const { config, issues } = normalizeConfig({ enabled: false, showActivity: false })
  assert.deepEqual(issues, [])
  assert.equal(config.enabled, false)
  assert.equal(config.showActivity, false)
  assert.equal(config.stallMs, 15000)
  assert.equal(config.blockFadeMs, 160)
})

test('logLevel accepts every documented level', () => {
  for (const level of LOG_LEVELS) {
    const { config, issues } = normalizeConfig({ logLevel: level })
    assert.equal(config.logLevel, level)
    assert.deepEqual(issues, [])
  }
})

test('README documents every option with its type, default, range and effect', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8')
  const rows = [...readme.matchAll(/^\|\s*`([A-Za-z]+)`\s*\|([^\n]*)\|\s*$/gm)]
  const documented = new Map(rows.map(([, key, rest]) => [key, rest.split('|').map((cell) => cell.trim())]))
  for (const key of KEYS) {
    const cells = documented.get(key)
    assert.ok(cells, `README has no table row for ${key}`)
    const [type, defaultCell, range] = cells
    const rule = SPEC[key]
    assert.ok(type.includes(rule.type === 'boolean' ? 'boolean' : rule.type === 'integer' ? 'number' : 'enum'), `${key} type cell`)
    assert.ok(defaultCell.includes(String(rule.default)), `${key} default cell`)
    if (rule.type === 'integer') {
      assert.ok(range.includes(String(rule.min)) && range.includes(String(rule.max)), `${key} range cell`)
    }
    if (rule.type === 'enum') {
      for (const value of rule.values) assert.ok(range.includes(value), `${key} range lists ${value}`)
    }
  }
})
