// Host-half tests: row config validation, the published index-injection row,
// and the diagnostics gate.
//
//   node --test test/host.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULTS } from '../config.js'
import { GLOBAL_NAME, WIRE_VERSION, apply } from '../index.js'

/**
 * Run one row activation and render the index.
 * @param {unknown} config - raw row config.
 * @returns {{ table: object[], logs: Array<{ level: string, text: string }> }} what the row did.
 */
function activate(config) {
  const listeners = new Map()
  const table = []
  const logs = []
  const ctx = {
    on(event, listener) {
      listeners.set(event, listener)
      return () => {}
    },
  }
  const originals = { warn: console.warn, info: console.info, debug: console.debug }
  for (const level of ['warn', 'info', 'debug']) {
    console[level] = (...args) => logs.push({ level, text: args.join(' ') })
  }
  try {
    apply(ctx, config)
    listeners.get('webserver/index-inject')(table)
  } finally {
    for (const level of ['warn', 'info', 'debug']) console[level] = originals[level]
  }
  return { table, logs }
}

test('a row without config publishes the defaults and stays silent', () => {
  const { table, logs } = activate(undefined)
  assert.equal(table.length, 1)
  const [row] = table
  assert.equal(row.kind, 'global')
  assert.equal(row.name, GLOBAL_NAME)
  assert.equal(row.value.version, WIRE_VERSION)
  assert.deepEqual(row.value.config, DEFAULTS)
  assert.deepEqual(row.value.defaults, DEFAULTS)
  assert.deepEqual(row.value.issues, [])
  assert.deepEqual(logs, [], 'logLevel warn + a valid config prints nothing')
})

test('a profile override reaches the browser as one normalized object', () => {
  const { table, logs } = activate({ stallMs: 8000, showActivity: false })
  assert.deepEqual(logs, [])
  assert.equal(table.length, 1)
  assert.equal(table[0].value.config.stallMs, 8000)
  assert.equal(table[0].value.config.showActivity, false)
  assert.equal(table[0].value.config.caretPeriodMs, DEFAULTS.caretPeriodMs)
})

test('a malformed value warns with the option name and expectation, then falls back', () => {
  const { table, logs } = activate({ stallMs: 'fast' })
  assert.equal(logs.length, 1)
  assert.equal(logs[0].level, 'warn')
  assert.equal(logs[0].text,
    "[@local/stream-polish] config.stallMs must be an integer between 500 and 600000; got 'fast'; using 15000.")
  assert.equal(table[0].value.config.stallMs, DEFAULTS.stallMs)
  assert.equal(table[0].value.issues.length, 1)
})

test('logLevel silent suppresses every diagnostic', () => {
  const { logs } = activate({ stallMs: 'fast', logLevel: 'silent' })
  assert.deepEqual(logs, [])
})

test('logLevel info reports acceptance and logLevel debug adds the resolved value', () => {
  const info = activate({ logLevel: 'info' })
  assert.equal(info.logs.length, 1)
  assert.equal(info.logs[0].level, 'info')
  assert.match(info.logs[0].text, /configuration accepted/)

  const debug = activate({ logLevel: 'debug' })
  const levels = debug.logs.map((entry) => entry.level)
  assert.deepEqual(levels, ['info', 'debug'])
  assert.match(debug.logs[1].text, /resolved config \{/)
})

test('the index row is emitted on every render, reading fresh state', () => {
  const listeners = new Map()
  const ctx = { on(event, listener) { listeners.set(event, listener) } }
  apply(ctx, { showElapsed: false })
  const first = []
  const second = []
  listeners.get('webserver/index-inject')(first)
  listeners.get('webserver/index-inject')(second)
  assert.equal(first.length, 1)
  assert.equal(second.length, 1)
  assert.equal(second[0].value.config.showElapsed, false)
})
