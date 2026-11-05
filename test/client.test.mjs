// Client-half tests: the module runs inside a `node:vm` sandbox with stubbed
// `window` / `document` / `MutationObserver` / `localStorage`, so resolution,
// precedence, validation parity, CSS generation, live re-application and the
// settings store are all asserted without a browser and without a dev
// dependency.
//
//   node --test test/client.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

import { DEFAULTS, SPEC, issueMessage } from '../config.js'

const CLIENT = new URL('../client.js', import.meta.url)

/**
 * Copy a value out of the vm realm so `assert` compares data, not prototypes.
 * @param {unknown} value - any JSON-shaped value.
 * @returns {unknown} the same value owned by this realm.
 */
function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

/**
 * Load `client.js` into a fresh sandbox and build its module.
 * @param {{ wire?: unknown, saved?: unknown, hook?: unknown }} [sources] - injection points.
 * @returns {Promise<object>} the sandbox, module, and captured side effects.
 */
async function loadClient(sources = {}) {
  const code = await readFile(CLIENT, 'utf8')
  const logs = []
  const styles = []
  const observers = []
  const calls = { create: 0 }
  const storage = new Map(
    sources.saved === undefined || typeof sources.saved !== 'object'
      ? []
      : [['dsh.stream-polish.settings', JSON.stringify(sources.saved)]],
  )

  const push = (level) => (...args) => logs.push({ level, text: args.join(' ') })

  const document = {
    head: {
      appendChild(element) {
        styles.push(element)
      },
    },
    documentElement: {},
    createElement() {
      calls.create += 1
      return {
        dataset: {},
        textContent: '',
        remove() {
          const index = styles.indexOf(this)
          if (index >= 0) styles.splice(index, 1)
        },
      }
    },
    querySelectorAll() {
      return []
    },
  }

  class MutationObserver {
    constructor(callback) {
      this.callback = callback
      observers.push(this)
    }

    observe() {}

    disconnect() {}
  }

  const sandbox = {
    console: { warn: push('warn'), info: push('info'), debug: push('debug'), log: push('log'), error: push('error') },
    document,
    MutationObserver,
    HTMLElement: class {},
    window: {
      __ModuleLoader__: {
        load(definition) {
          sandbox.definition = definition
        },
      },
      localStorage: {
        getItem(key) {
          return storage.has(key) ? storage.get(key) : null
        },
        setItem(key, value) {
          storage.set(key, value)
        },
        removeItem(key) {
          storage.delete(key)
        },
      },
      matchMedia() {
        return { matches: false }
      },
      setTimeout() {
        return 0
      },
      clearTimeout() {},
      setInterval() {
        return 0
      },
      clearInterval() {},
      location: { reload() {} },
    },
  }
  if (sources.wire !== undefined) sandbox.__DSH_STREAM_POLISH__ = sources.wire
  if (sources.hook !== undefined) sandbox.__DSH_SP_STALL_MS__ = sources.hook

  vm.createContext(sandbox)
  vm.runInContext(code, sandbox)

  const react = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => [initial, () => {}],
    useEffect: () => {},
  }
  const module = sandbox.definition.factory((name) => {
    if (name === 'react') return react
    throw new Error('unexpected require: ' + name)
  })

  return { module, sandbox, logs, styles, observers, calls, storage }
}

/**
 * Run `apply` against a context that records what the plugin mounts.
 * @param {object} module - the built module.
 * @returns {object} recorded effects, injections and registrations.
 */
function applyClient(module) {
  const effects = []
  const injected = []
  const registrations = []
  const ctx = {
    effect(fn, label) {
      effects.push({ label, dispose: fn() })
      return () => {}
    },
    locale: {
      register() {
        return () => {}
      },
      bind() {
        return (key) => key
      },
    },
    slots: {
      inject(key, callback) {
        injected.push(key)
        return callback()
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }
  module.apply(ctx)
  return { effects, injected, registrations }
}

/** Only the decoration stylesheets (the settings page has its own). */
function decorationStyles(load) {
  return load.styles.filter((style) => style.dataset.plugin !== undefined)
}

/** The decoration stylesheet text mounted by one `apply` call. */
function cssOf(load) {
  return decorationStyles(load).map((style) => style.textContent).join('')
}

test('the client mirror matches config.js exactly', async () => {
  const { sandbox } = await loadClient()
  const mirror = sandbox.__DSH_STREAM_POLISH_CLIENT__
  assert.equal(mirror.version, 3)
  assert.deepEqual(plain(mirror.defaults), DEFAULTS)
  assert.deepEqual(plain(Object.keys(mirror.spec)), Object.keys(SPEC))
  for (const key of Object.keys(SPEC)) {
    const expected = { type: SPEC[key].type, default: SPEC[key].default }
    if (SPEC[key].min !== undefined) expected.min = SPEC[key].min
    if (SPEC[key].max !== undefined) expected.max = SPEC[key].max
    if (SPEC[key].values !== undefined) expected.values = [...SPEC[key].values]
    if (SPEC[key].pattern !== undefined) expected.pattern = String(SPEC[key].pattern)
    const actual = { type: mirror.spec[key].type, default: mirror.spec[key].default }
    if (mirror.spec[key].min !== undefined) actual.min = mirror.spec[key].min
    if (mirror.spec[key].max !== undefined) actual.max = mirror.spec[key].max
    if (mirror.spec[key].values !== undefined) actual.values = [...mirror.spec[key].values]
    if (mirror.spec[key].pattern !== undefined) actual.pattern = String(mirror.spec[key].pattern)
    assert.deepEqual(plain(actual), expected, key)
  }
})

test('no configuration source means the previous release behaviour', async () => {
  const load = await loadClient()
  const { store, issues } = load.sandbox.__DSH_STREAM_POLISH_CLIENT__
  assert.deepEqual(plain(store.get()), DEFAULTS)
  assert.deepEqual(plain(issues), [])
  assert.equal(store.isDefault(), true)
  assert.deepEqual(load.logs, [], 'a valid default config stays silent at logLevel warn')
})

test('the host row config overrides defaults', async () => {
  const { sandbox } = await loadClient({
    wire: { version: 3, config: { stallMs: 800, showElapsed: false, blockFadeMs: 240 } },
  })
  const { store } = sandbox.__DSH_STREAM_POLISH_CLIENT__
  assert.equal(store.get().stallMs, 800)
  assert.equal(store.get().showElapsed, false)
  assert.equal(store.get().blockFadeMs, 240)
  assert.equal(store.get().runStrip, true)
  assert.equal(store.isDefault(), true, 'the row config is the baseline, not a local change')
})

test('this browser beats the host row, and the test hook beats both', async () => {
  const saved = await loadClient({
    wire: { version: 3, config: { stallMs: 800 } },
    saved: { stallMs: 4000 },
  })
  assert.equal(saved.sandbox.__DSH_STREAM_POLISH_CLIENT__.store.get().stallMs, 4000)

  const hook = await loadClient({
    wire: { version: 3, config: { stallMs: 800 } },
    saved: { stallMs: 4000 },
    hook: 900,
  })
  assert.equal(hook.sandbox.__DSH_STREAM_POLISH_CLIENT__.store.get().stallMs, 900)
})

test('a wire payload from another version is ignored', async () => {
  const { sandbox } = await loadClient({ wire: { version: 1, config: { stallMs: 800 } } })
  assert.equal(sandbox.__DSH_STREAM_POLISH_CLIENT__.store.get().stallMs, DEFAULTS.stallMs)
})

test('an unusable saved override warns with the shared message and keeps the default', async () => {
  const load = await loadClient({ saved: { stallMs: 'fast' } })
  const { store, issues } = load.sandbox.__DSH_STREAM_POLISH_CLIENT__
  assert.equal(store.get().stallMs, DEFAULTS.stallMs)
  assert.equal(issues.length, 1)
  assert.equal(issues[0].message, issueMessage('stallMs', 'fast'))
  assert.equal(load.logs.length, 1)
  assert.equal(load.logs[0].level, 'warn')
  assert.equal(load.logs[0].text, '[@local/stream-polish] ' + issueMessage('stallMs', 'fast'))
})

test('an unreadable saved blob is ignored without a thrown error', async () => {
  const load = await loadClient()
  load.sandbox.window.localStorage.setItem('dsh.stream-polish.settings', '{ not json')
  const { sandbox } = await loadClient()
  assert.deepEqual(plain(sandbox.__DSH_STREAM_POLISH_CLIENT__.store.get()), plain(DEFAULTS))
})

test('logLevel silent suppresses diagnostics', async () => {
  const load = await loadClient({ saved: { stallMs: 'fast', logLevel: 'silent' } })
  assert.deepEqual(load.logs, [])
})

test('logLevel debug reports the resolved state', async () => {
  const load = await loadClient({ wire: { version: 3, config: { logLevel: 'debug' } } })
  const levels = load.logs.map((entry) => entry.level)
  assert.ok(levels.includes('info'))
  assert.ok(levels.includes('debug'))
})

test('the default mount installs two stylesheets, two observers, two slots', async () => {
  const load = await loadClient()
  const mounted = applyClient(load.module)
  assert.equal(decorationStyles(load).length, 1, 'decoration stylesheet')
  assert.equal(decorationStyles(load)[0].dataset.plugin, '@local/stream-polish')
  assert.equal(load.styles.length, 2, 'plus the settings-page stylesheet')
  assert.equal(load.observers.length, 2, 'settle + run observers')
  assert.deepEqual(mounted.injected, [
    'conversation.input.dock',
    'conversation.chat.reasoning.body',
    'plugins.bundle.config',
  ])
  assert.equal(mounted.registrations.length, 3)
  assert.equal(mounted.registrations[0].options.id, 'run-strip')
  assert.equal(mounted.registrations[1].options.id, 'step-panel')
  assert.equal(mounted.registrations[2].options.key, '@local/stream-polish', 'the bundle page is keyed by package name')
  assert.equal(mounted.effects.length, 3, 'dictionaries, page styles, surfaces')

  const css = cssOf(load)
  assert.ok(css.includes('animation:dshSP_blockIn 160ms'), 'block fade default')
  assert.ok(css.includes('animation:dshSP_caret 1200ms'), 'caret period default')
  assert.ok(css.includes('animation:dshSP_caretOut 260ms'), 'settle fade default')
  assert.ok(css.includes('.dshRS_pill'), 'capsule styles')
  assert.ok(css.includes('.dshST_card'), 'step panel styles')
  assert.ok(css.includes('--dshST-accent:#4f8cff'), 'accent colour from configuration')
  assert.ok(!css.includes('.dshTR_root'), 'translation is off by default')
})

test('durations come from configuration', async () => {
  const load = await loadClient({
    wire: { version: 3, config: { blockFadeMs: 200, caretPeriodMs: 2000, settleMs: 400 } },
  })
  applyClient(load.module)
  const css = cssOf(load)
  assert.ok(css.includes('animation:dshSP_blockIn 200ms'))
  assert.ok(css.includes('animation:dshSP_caret 2000ms'))
  assert.ok(css.includes('animation:dshSP_caretOut 400ms'))
  assert.ok(!css.includes('animation:dshSP_blockIn 160ms'))
  assert.ok(!css.includes('animation:dshSP_caret 1200ms'))
})

test('blockFade: false contributes no block rule', async () => {
  const load = await loadClient({ wire: { version: 3, config: { blockFade: false } } })
  applyClient(load.module)
  const css = cssOf(load)
  assert.ok(!css.includes('dshSP_blockIn'))
  assert.ok(css.includes('dshSP_caret'))
})

test('caret: false drops the caret and its settle observer', async () => {
  const load = await loadClient({ wire: { version: 3, config: { caret: false } } })
  applyClient(load.module)
  const css = cssOf(load)
  assert.ok(!css.includes('dshSP_caret'))
  assert.ok(!css.includes('dshSP_caretOut'))
  assert.equal(load.observers.length, 1, 'only the run observer remains')
})

test('settleFade: false drops the fade but keeps the breathing caret', async () => {
  const load = await loadClient({ wire: { version: 3, config: { settleFade: false } } })
  applyClient(load.module)
  const css = cssOf(load)
  assert.ok(css.includes('dshSP_caret '))
  assert.ok(!css.includes('dshSP_caretOut'))
  assert.ok(!css.includes('data-dsh-sp-settling'))
  assert.equal(load.observers.length, 1)
})

test('runStrip: false drops the capsule styles and its observer', async () => {
  const load = await loadClient({ wire: { version: 3, config: { runStrip: false } } })
  applyClient(load.module)
  const css = cssOf(load)
  assert.ok(!css.includes('dshRS'))
  assert.equal(load.observers.length, 1, 'only the settle observer remains')
})

test('enabled: false mounts no decoration but keeps the settings page', async () => {
  const load = await loadClient({ wire: { version: 3, config: { enabled: false } } })
  const mounted = applyClient(load.module)
  assert.equal(decorationStyles(load).length, 0, 'no decoration stylesheet')
  assert.equal(load.observers.length, 0)
  assert.equal(load.styles.length, 1, 'the settings page still has its stylesheet')
  assert.deepEqual(mounted.injected, [
    'conversation.input.dock',
    'conversation.chat.reasoning.body',
    'plugins.bundle.config',
  ])
  assert.equal(mounted.registrations.length, 3, 'the page must be reachable to switch it back on')
})

test('a store update re-applies immediately and persists the diff', async () => {
  const load = await loadClient()
  applyClient(load.module)
  const { store } = load.sandbox.__DSH_STREAM_POLISH_CLIENT__
  assert.equal(load.observers.length, 2)

  const changed = store.update({ caret: false })
  assert.equal(changed, true)
  assert.equal(store.get().caret, false)
  assert.ok(!cssOf(load).includes('dshSP_caret'), 'the caret rule is gone after the update')
  assert.equal(load.observers.length, 3, 'the settle observer is gone, the run observer was re-created')
  assert.equal(store.isDefault(), false)

  const saved = JSON.parse(load.storage.get('dsh.stream-polish.settings'))
  assert.deepEqual(saved, { caret: false }, 'only the changed key is persisted')
})

test('store.update rejects unusable values without touching the store', async () => {
  const load = await loadClient()
  applyClient(load.module)
  const { store } = load.sandbox.__DSH_STREAM_POLISH_CLIENT__
  assert.equal(store.update({ stallMs: 1 }), false)
  assert.equal(store.update({ stallMs: 'fast' }), false)
  assert.equal(store.update({ nope: true }), false)
  assert.equal(store.get().stallMs, DEFAULTS.stallMs)
  assert.equal(load.storage.has('dsh.stream-polish.settings'), false)
})

test('store.reset returns to the row config and clears the saved layer', async () => {
  const load = await loadClient({ wire: { version: 3, config: { stallMs: 800 } } })
  applyClient(load.module)
  const { store } = load.sandbox.__DSH_STREAM_POLISH_CLIENT__
  store.update({ stallMs: 4000, showActivity: false })
  assert.equal(store.get().stallMs, 4000)

  store.reset()
  assert.equal(store.get().stallMs, 800, 'the row config survives a reset')
  assert.equal(store.get().showActivity, true)
  assert.equal(store.isDefault(), true)
  assert.equal(load.storage.has('dsh.stream-polish.settings'), false)
})

test('a settings change rebuilds the stylesheet instead of stacking one', async () => {
  const load = await loadClient()
  applyClient(load.module)
  const { store } = load.sandbox.__DSH_STREAM_POLISH_CLIENT__
  store.update({ blockFadeMs: 200 })
  store.update({ blockFadeMs: 300 })
  assert.equal(decorationStyles(load).length, 1, 'one decoration stylesheet at a time')
  assert.ok(cssOf(load).includes('dshSP_blockIn 300ms'))
})

test('every literal translation key exists in both dictionaries', async () => {
  const code = await readFile(CLIENT, 'utf8')
  const used = new Set([...code.matchAll(/(?<![\w$.])t\('([a-zA-Z][\w.]*)'/g)]
    .map((match) => match[1])
    .filter((key) => !key.endsWith('.')))
  assert.ok(used.size > 20, 'the scan found the page copy')
  for (const key of used) {
    const occurrences = [...code.matchAll(new RegExp("'" + key.replace(/\./g, '\\.') + "':", 'g'))]
    assert.equal(occurrences.length, 2, `key ${key} must exist once in zh and once in en`)
  }
})

test('stablePrefix only exposes completed or bounded text', async () => {
  const { sandbox } = await loadClient()
  const { stablePrefix } = sandbox.__DSH_STREAM_POLISH_CLIENT__
  assert.equal(stablePrefix('abc', 0, 4000), 0, 'an unfinished single line stays original')
  assert.equal(stablePrefix('a\n\nb', 0, 4000), 3, 'a completed paragraph is translated')
  assert.equal(stablePrefix('a\nb', 0, 4000), 2, 'without a blank line a completed line is translated')
  assert.equal(stablePrefix('a\n\nb', 3, 4000), 3, 'the cursor moves past translated text')
  const long = 'word '.repeat(1200)
  const end = stablePrefix(long, 0, 4000)
  assert.ok(end >= 3900 && end <= long.length, 'a long paragraph is cut near the request limit')
})

test('buildSteps uses the Chat node index and keeps tool-call rows', async () => {
  const { sandbox } = await loadClient()
  const { buildSteps } = sandbox.__DSH_STREAM_POLISH_CLIENT__
  const assistant = {
    kind: 'assistant-step',
    visibility: 'visible',
    anchorSeq: 10,
    location: { kind: 'step', turn: { turn: 4 }, step: { step: 1 } },
    data: {
      status: 'settled',
      turn: 4,
      step: 1,
      blocks: [
        { kind: 'reasoning', text: 'look\ncloser' },
        { kind: 'text', text: 'done' },
      ],
      finalNode: { timing: { stepStartTime: 1000, completedTime: 2500 } },
    },
  }
  const tool = {
    kind: 'tool-call',
    visibility: 'visible',
    anchorSeq: 11,
    location: { kind: 'step', turn: { turn: 4 }, step: { step: 1 } },
    data: {
      root: {
        kind: 'tool-result',
        callId: 'call-1',
        name: 'Read',
        time: 3200,
        callTime: 2500,
        isError: false,
        args: { text: (key) => (key === 'file_path' ? 'README.md' : undefined) },
      },
    },
  }
  const snapshot = {
    timeline: { turnOrder: [4], turns: new Map([[4, { steps: [] }]]) },
    locations: { getTurn: (turn) => (turn === 4 ? ['a', 't'] : []) },
    nodes: { get: (key) => (key === 'a' ? assistant : key === 't' ? tool : undefined) },
    legacy: { nodes: [], runningCalls: [], partial: null },
  }
  const projected = buildSteps(snapshot, { stepPanelRows: 5 }, 4000)
  assert.deepEqual(plain(projected.rows.map((row) => [row.kind, row.action, row.object, row.status, row.duration])), [
    ['thinking', 'step.thinking', 'look', 'done', 1500],
    ['reply', 'step.reply', 'done', 'done', 1500],
    ['tool', 'Read', 'README.md', 'done', 700],
  ])
})

test('buildSteps projects this turn, statuses, objects, durations and the visible limit', async () => {
  const { sandbox } = await loadClient()
  const { buildSteps } = sandbox.__DSH_STREAM_POLISH_CLIENT__
  const snapshot = {
    timeline: {
      turnOrder: [1],
      turns: new Map([[1, { steps: [{ step: 1, start: { time: 1000 } }] }]]),
    },
    legacy: {
      nodes: [
        {
          kind: 'assistant', seq: 2, turn: 1, step: 1,
          timing: { stepStartTime: 1000, completedTime: 3000 },
          blocks: [
            { kind: 'reasoning', text: 'plan\nmore' },
            { kind: 'text', text: 'answer' },
            { kind: 'tool-call', callId: 'c1', name: 'Bash', argsRaw: '{}' },
          ],
        },
        {
          kind: 'tool-result', seq: 3, time: 3500, callTime: 3000, callId: 'c1', name: 'Bash',
          args: { text: (key) => (key === 'command' ? 'ls -la' : undefined) },
          location: { kind: 'step', turn: { turn: 1 }, step: { step: 1 } },
          isError: false,
        },
      ],
      runningCalls: [{
        callId: 'c2', name: 'Read', turn: 1, step: 1, time: 4000, phase: 'start',
        args: { text: (key) => (key === 'file_path' ? 'a.js' : undefined) },
      }],
      partial: { turn: 1, step: 1, blocks: [{ kind: 'reasoning', text: 'live thought' }] },
    },
  }
  const all = buildSteps(snapshot, { stepPanelRows: 5 }, 5000)
  assert.equal(all.turn, 1)
  assert.equal(all.hidden, 0)
  assert.deepEqual(plain(all.rows.map((row) => row.kind)), ['thinking', 'reply', 'tool', 'tool', 'thinking'])
  assert.equal(all.rows[0].object, 'plan')
  assert.equal(all.rows[0].duration, 2000)
  assert.equal(all.rows[2].action, 'Bash')
  assert.equal(all.rows[2].object, 'ls -la')
  assert.equal(all.rows[2].status, 'done')
  assert.equal(all.rows[2].duration, 500)
  assert.equal(all.rows[3].status, 'running')
  assert.equal(all.rows[3].object, 'a.js')
  assert.equal(all.rows[3].duration, 1000)
  assert.equal(all.rows[4].status, 'running')
  assert.equal(all.rows[4].duration, 4000, 'the partial Assistant uses the step start')

  const bounded = buildSteps(snapshot, { stepPanelRows: 2 }, 5000)
  assert.equal(bounded.hidden, 3)
  assert.deepEqual(plain(bounded.rows.map((row) => row.kind)), ['tool', 'thinking'])

  assert.deepEqual(plain(buildSteps({ timeline: { turnOrder: [], turns: new Map() }, legacy: {} }, { stepPanelRows: 5 }, 0)),
    { turn: null, rows: [], hidden: 0 })
})


test('translation registers the reasoning body only when enabled and available', async () => {
  const available = await loadClient({
    wire: {
      version: 3,
      config: { translation: true },
      capabilities: { translation: { available: true, maxTextChars: 4000 } },
    },
  })
  const mounted = applyClient(available.module)
  assert.deepEqual(mounted.injected, [
    'conversation.input.dock',
    'conversation.chat.reasoning.body',
    'plugins.bundle.config',
  ])
  assert.equal(mounted.registrations.length, 4)
  const reasoning = mounted.registrations.find((entry) => entry.options.name === 'conversation.chat.reasoning.body')
  assert.equal(reasoning.options.priority, -1)
  assert.ok(cssOf(available).includes('.dshTR_root'), 'translation toolbar styles')

  const missingService = await loadClient({
    wire: {
      version: 3,
      config: { translation: true },
      capabilities: { translation: { available: false, maxTextChars: null } },
    },
  })
  const disabled = applyClient(missingService.module)
  assert.equal(
    disabled.registrations.some((entry) => entry.options.name === 'conversation.chat.reasoning.body'),
    false,
    'no wrapper shadows the built-in body when the translator is unavailable',
  )
  assert.ok(cssOf(missingService).includes('.dshTR_root'), 'toolbar styles follow the switch, not availability')
})

test('stepPanel: false drops the panel styles but keeps the capsule', async () => {
  const load = await loadClient({ wire: { version: 3, config: { stepPanel: false } } })
  applyClient(load.module)
  const css = cssOf(load)
  assert.ok(!css.includes('.dshST_card'))
  assert.ok(css.includes('.dshRS_pill'))
})

test('replaceToolRows contributes the transcript hide rule only when enabled', async () => {
  const off = await loadClient()
  applyClient(off.module)
  assert.ok(!cssOf(off).includes('data-dsh-sp-tools-hidden'))

  const on = await loadClient({ wire: { version: 3, config: { replaceToolRows: true } } })
  applyClient(on.module)
  const css = cssOf(on)
  assert.ok(css.includes('html[data-dsh-sp-tools-hidden] [data-chat-flow] [data-tool]'))
  assert.ok(css.includes('display:none'))
})

test('toolCardPolish contributes paint-only tool row styles', async () => {
  const on = await loadClient({ wire: { version: 3, config: { toolCardPolish: true } } })
  applyClient(on.module)
  const css = cssOf(on)
  assert.ok(css.includes(':where([data-chat-flow] [data-tool])'))
  assert.ok(css.includes('box-shadow:inset 0 0 0 .5px'))
  assert.ok(!css.includes('data-tool]{border:'), 'the tool rule adds no layout-changing border')

  const off = await loadClient({ wire: { version: 3, config: { toolCardPolish: false } } })
  applyClient(off.module)
  assert.ok(!cssOf(off).includes(':where([data-chat-flow] [data-tool])'))
})


test('the bundle settings page renders without throwing', async () => {
  const load = await loadClient({
    wire: {
      version: 3,
      config: { stepPanel: true, translation: true },
      capabilities: { translation: { available: true, maxTextChars: 4000 } },
    },
  })
  const mounted = applyClient(load.module)
  const page = mounted.registrations.find((entry) => entry.options.key === '@local/stream-polish')
  assert.equal(typeof page.component, 'function')
  let tree
  assert.doesNotThrow(() => {
    tree = page.component({ view: 'page', t: (key) => key })
  })
  assert.ok(tree && typeof tree === 'object')
  assert.equal(typeof tree.type, 'function', 'the page component is returned for view:page')
  let rendered
  assert.doesNotThrow(() => {
    rendered = tree.type(tree.props)
  })
  assert.equal(rendered.props.className, 'dshSPS_page')
  const preview = rendered.children.find((child) => typeof child?.type === 'function' && child.type.name === 'PreviewPanel')
  assert.ok(preview, 'the page mounts the preview panel')
  let previewTree
  assert.doesNotThrow(() => {
    previewTree = preview.type(preview.props)
  })
  assert.equal(previewTree.props.className, 'dshSPS_preview')
})
