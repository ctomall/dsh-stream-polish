// Real-browser checks for the Client half.
//
// `client.js` is a plain script, so it can be driven without the profile that
// ships it: the page provides the `__ModuleLoader__` stub and a tiny React
// stand-in, then calls the module's `apply` and inspects what the browser
// actually computed. That turns "the CSS string looks right" into "Chrome
// matched the selector, started the animation, and cleaned up the settle
// attribute".
//
// Chrome comes from the Playwright cache (or CHROME_PATH). The suite skips —
// not fails — on a machine without one, and adds no dependency.
//
//   node --test test/browser.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const CLIENT = new URL('../client.js', import.meta.url)

/**
 * Locate a usable Chromium build.
 * @returns {string | undefined} absolute path, or undefined when none exists.
 */
function findChrome() {
  if (process.env.CHROME_PATH) {
    return existsSync(process.env.CHROME_PATH) ? process.env.CHROME_PATH : undefined
  }
  const root = join(homedir(), '.cache', 'ms-playwright')
  if (!existsSync(root)) return undefined
  const candidates = readdirSync(root)
    .filter((name) => name.startsWith('chromium-'))
    .sort()
    .reverse()
    .flatMap((name) => [
      join(root, name, 'chrome-linux64', 'chrome'),
      join(root, name, 'chrome-linux', 'chrome'),
    ])
  return candidates.find((path) => existsSync(path))
}

const CHROME = findChrome()

/**
 * Minimal CDP client over Node's built-in WebSocket.
 */
class Devtools {
  /** @param {string} bin - Chrome path. */
  constructor(bin) {
    this.bin = bin
    this.pending = new Map()
    this.nextId = 0
    this.child = null
    this.socket = null
  }

  /** Launch Chrome and attach to its first page target. */
  async start() {
    this.child = spawn(this.bin, [
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--hide-scrollbars',
      '--remote-debugging-port=0',
      'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] })

    let url = ''
    this.child.stderr.setEncoding('utf8')
    this.child.stderr.on('data', (chunk) => {
      const found = String(chunk).match(/DevTools listening on (ws:\/\/\S+)/)
      if (found !== null) url = found[1]
    })

    const deadline = Date.now() + 15000
    while (url === '') {
      if (this.child.exitCode !== null) throw new Error('chrome exited before DevTools was ready')
      if (Date.now() > deadline) throw new Error('timed out waiting for the DevTools endpoint')
      await new Promise((resolve) => setTimeout(resolve, 50))
    }

    const port = new URL(url).port
    const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()
    const page = targets.find((target) => target.type === 'page')
    if (page === undefined) throw new Error('no page target')

    this.socket = new WebSocket(page.webSocketDebuggerUrl)
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      const waiter = this.pending.get(message.id)
      if (waiter !== undefined) {
        this.pending.delete(message.id)
        waiter(message)
      }
    })
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })

    await this.send('Page.enable')
    await this.send('Runtime.enable')
  }

  /**
   * Issue one CDP command.
   * @param {string} method - CDP method.
   * @param {object} [params] - parameters.
   * @returns {Promise<object>} the response message.
   */
  send(method, params = {}) {
    const id = ++this.nextId
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  /**
   * Evaluate an expression in the page, awaiting a returned promise.
   * @param {string} expression - JS source.
   * @returns {Promise<unknown>} the by-value result.
   */
  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    const result = response.result
    if (result?.exceptionDetails !== undefined) {
      throw new Error('page threw: ' + JSON.stringify(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text))
    }
    return result?.result?.value
  }

  /** @param {string} url - page URL. */
  async open(url) {
    await this.send('Page.navigate', { url })
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      const ready = await this.evaluate("typeof window.__done__ !== 'undefined'")
      if (ready === true) return
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error('page never armed __done__')
  }

  /** Shut Chrome down. */
  close() {
    try {
      this.socket?.close()
    } catch {
      // Nothing to close.
    }
    this.child?.kill('SIGKILL')
  }
}

/**
 * Build one harness page.
 * @param {string} clientCode - the Client half's source.
 * @param {object | undefined} config - row config to inject.
 * @param {string} body - in-page scenario returning the result object.
 * @returns {string} the HTML document.
 */
function harness(clientCode, config, body) {
  const wire = config === undefined
    ? ''
    : '<script>window.__DSH_STREAM_POLISH__ = ' + JSON.stringify({ version: 2, config }) + '</script>'
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script>window.__ModuleLoader__ = { load(def) { window.__def = def } }</script>
${wire}
<script>${clientCode}</script>
<script>
window.__done__ = (async () => {
  try {
    const React = { createElement: (t, p, ...c) => ({ t, p, c }), useState: (v) => [v, () => {}], useEffect: () => {} }
    const mod = window.__def.factory((name) => {
      if (name === 'react') return React
      throw new Error('require ' + name)
    })
    const mounted = { styles: 0, slots: 0, observers: 0 }
    const RealObserver = window.MutationObserver
    window.MutationObserver = class extends RealObserver {
      constructor(cb) { super(cb); mounted.observers += 1 }
    }
    const ctx = {
      effect(fn) { fn() },
      locale: { register() { return () => {} } },
      slots: {
        inject(key, callback) { mounted.slots += 1; return callback() },
        register() { return () => {} },
      },
    }
    ${body}
  } catch (error) {
    return { error: String(error && error.stack || error) }
  }
})()
</script></body></html>`
}

/** The scenario shared by every behavioral case: stream, settle, clean up. */
const STREAM_BODY = `
    const root = document.createElement('div')
    root.setAttribute('data-streaming', '')
    root.innerHTML = '<div><div><p id="last">hello</p></div></div>'
    document.body.appendChild(root)
    mod.apply(ctx)
    mounted.styles = document.querySelectorAll('style[data-plugin]').length
    const p = document.getElementById('last')
    const tail = getComputedStyle(p, '::after')
    const block = getComputedStyle(p)
    const streaming = {
      caretWidth: tail.width,
      caretAnimation: tail.animationName,
      caretDuration: tail.animationDuration,
      caretOpacity: tail.opacity,
      blockAnimation: block.animationName,
      blockDuration: block.animationDuration,
      sheet: document.querySelector('style[data-plugin]').textContent,
    }
    root.removeAttribute('data-streaming')
    await new Promise((resolve) => setTimeout(resolve, 60))
    const settling = root.hasAttribute('data-dsh-sp-settling')
    const fading = getComputedStyle(p, '::after').animationName
    const fadeMs = getComputedStyle(p, '::after').animationDuration
    await new Promise((resolve) => setTimeout(resolve, 700))
    return {
      mounted,
      streaming,
      settling,
      fading,
      fadeMs,
      cleaned: !root.hasAttribute('data-dsh-sp-settling'),
    }
`

const skip = CHROME === undefined ? 'no Chromium found; set CHROME_PATH' : false

test('the browser resolves the default configuration', { skip }, async (t) => {
  const client = await readFile(CLIENT, 'utf8')
  const dir = await mkdtemp(join(tmpdir(), 'stream-polish-'))
  const file = join(dir, 'default.html')
  await writeFile(file, harness(client, undefined, STREAM_BODY))

  const devtools = new Devtools(CHROME)
  t.after(() => devtools.close())
  await devtools.start()
  await devtools.open('file://' + file)
  const result = await devtools.evaluate('window.__done__')

  assert.equal(result.error, undefined)
  assert.equal(result.mounted.styles, 1)
  assert.equal(result.mounted.observers, 2)
  assert.equal(result.mounted.slots, 2, 'run capsule + bundle config page')
  assert.equal(result.streaming.blockAnimation, 'dshSP_blockIn')
  assert.equal(result.streaming.blockDuration, '0.16s')
  assert.equal(result.streaming.caretWidth, '2px')
  assert.equal(result.streaming.caretAnimation, 'dshSP_caret')
  assert.equal(result.streaming.caretDuration, '1.2s')
  assert.equal(result.settling, true)
  assert.equal(result.fading, 'dshSP_caretOut')
  assert.equal(result.fadeMs, '0.26s')
  assert.equal(result.cleaned, true)
})

test('the browser applies configured durations', { skip }, async (t) => {
  const client = await readFile(CLIENT, 'utf8')
  const dir = await mkdtemp(join(tmpdir(), 'stream-polish-'))
  const file = join(dir, 'configured.html')
  await writeFile(file, harness(client, { blockFadeMs: 200, caretPeriodMs: 2000, settleMs: 400 }, STREAM_BODY))

  const devtools = new Devtools(CHROME)
  t.after(() => devtools.close())
  await devtools.start()
  await devtools.open('file://' + file)
  const result = await devtools.evaluate('window.__done__')

  assert.equal(result.error, undefined)
  assert.equal(result.streaming.blockDuration, '0.2s')
  assert.equal(result.streaming.caretDuration, '2s')
  assert.equal(result.fadeMs, '0.4s')
})

test('caret: false mounts no caret and no settle state', { skip }, async (t) => {
  const client = await readFile(CLIENT, 'utf8')
  const dir = await mkdtemp(join(tmpdir(), 'stream-polish-'))
  const file = join(dir, 'caret-off.html')
  await writeFile(file, harness(client, { caret: false }, STREAM_BODY))

  const devtools = new Devtools(CHROME)
  t.after(() => devtools.close())
  await devtools.start()
  await devtools.open('file://' + file)
  const result = await devtools.evaluate('window.__done__')

  assert.equal(result.error, undefined)
  assert.equal(result.streaming.caretWidth, 'auto')
  assert.equal(result.streaming.caretAnimation, 'none')
  assert.equal(result.streaming.blockAnimation, 'dshSP_blockIn')
  assert.equal(result.settling, false)
  assert.equal(result.mounted.observers, 1)
})

test('enabled: false mounts nothing', { skip }, async (t) => {
  const client = await readFile(CLIENT, 'utf8')
  const dir = await mkdtemp(join(tmpdir(), 'stream-polish-'))
  const file = join(dir, 'disabled.html')
  await writeFile(file, harness(client, { enabled: false }, `
    mod.apply(ctx)
    const root = document.createElement('div')
    root.setAttribute('data-streaming', '')
    root.innerHTML = '<div><div><p>hello</p></div></div>'
    document.body.appendChild(root)
    root.removeAttribute('data-streaming')
    await new Promise((resolve) => setTimeout(resolve, 60))
    return {
      mounted: {
        styles: document.querySelectorAll('style[data-plugin]').length,
        slots: mounted.slots,
        observers: mounted.observers,
      },
      settling: root.hasAttribute('data-dsh-sp-settling'),
    }
  `))

  const devtools = new Devtools(CHROME)
  t.after(() => devtools.close())
  await devtools.start()
  await devtools.open('file://' + file)
  const result = await devtools.evaluate('window.__done__')

  assert.equal(result.error, undefined)
  assert.deepEqual(result.mounted, { styles: 0, slots: 2, observers: 0 })
  assert.equal(result.settling, false)
})

test('runStrip: false drops the capsule styles and its observer', { skip }, async (t) => {
  const client = await readFile(CLIENT, 'utf8')
  const dir = await mkdtemp(join(tmpdir(), 'stream-polish-'))
  const file = join(dir, 'strip-off.html')
  await writeFile(file, harness(client, { runStrip: false }, STREAM_BODY))

  const devtools = new Devtools(CHROME)
  t.after(() => devtools.close())
  await devtools.start()
  await devtools.open('file://' + file)
  const result = await devtools.evaluate('window.__done__')

  assert.equal(result.error, undefined)
  assert.equal(result.mounted.observers, 1)
  assert.equal(result.streaming.sheet.includes('dshRS'), false)
  assert.equal(result.streaming.blockAnimation, 'dshSP_blockIn')
})

test('reduced motion turns the motion off without losing the caret', { skip }, async (t) => {
  const client = await readFile(CLIENT, 'utf8')
  const dir = await mkdtemp(join(tmpdir(), 'stream-polish-'))
  const file = join(dir, 'reduced.html')
  await writeFile(file, harness(client, undefined, STREAM_BODY))

  const devtools = new Devtools(CHROME)
  t.after(() => devtools.close())
  await devtools.start()
  await devtools.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })
  await devtools.open('file://' + file)
  const result = await devtools.evaluate('window.__done__')

  assert.equal(result.error, undefined)
  assert.equal(result.streaming.blockAnimation, 'none')
  assert.equal(result.streaming.caretAnimation, 'none')
  assert.equal(result.streaming.caretOpacity, '0.65')
  assert.equal(result.settling, false, 'no fade when motion is reduced')
})

test('the preview stylesheet follows the configured durations', { skip }, async (t) => {
  const client = await readFile(CLIENT, 'utf8')
  const dir = await mkdtemp(join(tmpdir(), 'stream-polish-'))
  const file = join(dir, 'preview.html')
  await writeFile(file, harness(client, undefined, `
    mod.apply(ctx)
    const stage = document.createElement('div')
    stage.style.setProperty('--dshSPS-fade', '250ms')
    stage.style.setProperty('--dshSPS-period', '900ms')
    const line = document.createElement('p')
    line.className = 'dshSPS_demoLine dshSPS_demoIn'
    line.textContent = 'fade me'
    const still = document.createElement('p')
    still.className = 'dshSPS_demoLine dshSPS_demoIn'
    still.setAttribute('data-fade', 'false')
    const caret = document.createElement('span')
    caret.className = 'dshSPS_demoCaret'
    const dot = document.createElement('span')
    dot.className = 'dshSPS_demoPillDot'
    stage.append(line, still, caret, dot)
    document.body.append(stage)
    const lineStyle = getComputedStyle(line)
    const stillStyle = getComputedStyle(still)
    const caretStyle = getComputedStyle(caret)
    const dotStyle = getComputedStyle(dot)
    return {
      mounted,
      faded: { name: lineStyle.animationName, duration: lineStyle.animationDuration },
      still: stillStyle.animationName,
      caret: {
        name: caretStyle.animationName,
        duration: caretStyle.animationDuration,
        width: caretStyle.width,
      },
      dot: { name: dotStyle.animationName, duration: dotStyle.animationDuration },
      sheets: document.querySelectorAll('style').length,
    }
  `))

  const devtools = new Devtools(CHROME)
  t.after(() => devtools.close())
  await devtools.start()
  await devtools.open('file://' + file)
  const result = await devtools.evaluate('window.__done__')

  assert.equal(result.error, undefined)
  assert.equal(result.sheets, 2, 'decoration stylesheet plus the page stylesheet')
  assert.equal(result.faded.name, 'dshSPS_in')
  assert.equal(result.faded.duration, '0.25s', 'the fade follows --dshSPS-fade')
  assert.equal(result.still, 'none', 'blockFade:false shows a static line')
  assert.equal(result.caret.name, 'dshSPS_breath')
  assert.equal(result.caret.duration, '0.9s', 'the breath follows --dshSPS-period')
  assert.equal(result.caret.width, '2px')
  assert.equal(result.dot.name, 'dshSPS_pulse')
})
