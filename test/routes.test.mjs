// Route tests for the authenticated `/api/stream-polish` surface.
//
//   node --test test/routes.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createRoutes } from '../lib/routes.js'

/**
 * Build the route table over a stub updater.
 * @param {object} updater - stub methods.
 * @param {() => object} [onUpgraded] - upgrade hook.
 * @returns {Map<string, object>} routes keyed by path.
 */
function build(updater, onUpgraded, options = {}) {
  const routes = createRoutes({
    updater,
    onUpgraded,
    settings: options.settings ?? {
      translationProvider: 'bing',
      translationTargetLanguage: 'zh-CN',
      translationTimeoutMs: 8000,
    },
    translatorOf: options.translatorOf ?? (() => options.translator),
  })
  return new Map(routes.map((route) => [route.path, route]))
}

/** A stub translator with the documented surface. */
function stubTranslator(overrides = {}) {
  return {
    maxTextChars: 40,
    resolve(request) {
      return { ...request, sourceLanguage: 'auto' }
    },
    async translate(spec) {
      if (overrides.translate !== undefined) return overrides.translate(spec)
      return 'translated:' + spec.text
    },
  }
}

/** A stub updater whose methods resolve the given values. */
function stubUpdater(overrides = {}) {
  return {
    info: async () => ({ ok: true, version: '1.1.0', shortCommit: 'abc1234', commit: 'abc1234def' }),
    status: async () => ({ ok: true, available: true, behind: 1, version: '1.1.0', latestVersion: '1.2.0' }),
    apply: async () => ({
      ok: true,
      changed: true,
      from: { version: '1.1.0' },
      to: { version: '1.2.0', shortCommit: 'def5678' },
    }),
    ...overrides,
  }
}

test('the route table is exactly the documented surface', () => {
  const routes = build(stubUpdater())
  assert.deepEqual([...routes.keys()], [
    '/api/stream-polish/info',
    '/api/stream-polish/update',
    '/api/stream-polish/update/apply',
    '/api/stream-polish/translation',
    '/api/stream-polish/translate',
  ])
  assert.deepEqual(routes.get('/api/stream-polish/info').methods, ['GET'])
  assert.deepEqual(routes.get('/api/stream-polish/update').methods, ['GET'])
  assert.deepEqual(routes.get('/api/stream-polish/update/apply').methods, ['POST'])
  assert.deepEqual(routes.get('/api/stream-polish/translation').methods, ['GET'])
  assert.deepEqual(routes.get('/api/stream-polish/translate').methods, ['POST'])
  for (const route of routes.values()) {
    assert.equal(route.requestBody, 'buffered')
    assert.equal(typeof route.fetch, 'function')
  }
})

test('info and status return JSON without caching', async () => {
  const routes = build(stubUpdater())

  const info = await routes.get('/api/stream-polish/info').fetch(new Request('http://x/api/stream-polish/info'))
  assert.equal(info.status, 200)
  assert.equal(info.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await info.json(), { ok: true, version: '1.1.0', shortCommit: 'abc1234', commit: 'abc1234def' })

  const status = await routes.get('/api/stream-polish/update').fetch(new Request('http://x/api/stream-polish/update'))
  assert.equal(status.status, 200)
  const body = await status.json()
  assert.equal(body.available, true)
  assert.equal(body.latestVersion, '1.2.0')
})

test('a successful upgrade reports the reload path the Host chose', async () => {
  let upgrades = 0
  const routes = build(stubUpdater(), () => {
    upgrades += 1
    return { reload: 'hmr' }
  })
  const response = await routes.get('/api/stream-polish/update/apply')
    .fetch(new Request('http://x/api/stream-polish/update/apply', { method: 'POST', body: '{}' }))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.changed, true)
  assert.equal(body.to.version, '1.2.0')
  assert.equal(body.reload, 'hmr')
  assert.equal(upgrades, 1)
})

test('an upgrade that changed nothing does not schedule a reload', async () => {
  let upgrades = 0
  const routes = build(stubUpdater({
    apply: async () => ({ ok: true, changed: false, message: '已是最新版本' }),
  }), () => {
    upgrades += 1
    return { reload: 'hmr' }
  })
  const response = await routes.get('/api/stream-polish/update/apply')
    .fetch(new Request('http://x/api/stream-polish/update/apply', { method: 'POST' }))
  const body = await response.json()
  assert.equal(body.changed, false)
  assert.equal('reload' in body, false)
  assert.equal(upgrades, 0)
})

test('a refused upgrade keeps the updater reason and schedules nothing', async () => {
  let upgrades = 0
  const routes = build(stubUpdater({
    apply: async () => ({ ok: false, error: 'dirty-worktree', message: '插件目录有未提交改动' }),
  }), () => {
    upgrades += 1
    return { reload: 'hmr' }
  })
  const response = await routes.get('/api/stream-polish/update/apply')
    .fetch(new Request('http://x/api/stream-polish/update/apply', { method: 'POST' }))
  const body = await response.json()
  assert.equal(body.ok, false)
  assert.equal(body.error, 'dirty-worktree')
  assert.equal(response.status, 200, 'a refusal is a normal answer, not a transport failure')
  assert.equal(upgrades, 0)
})

test('an unexpected throw becomes one JSON failure envelope', async () => {
  const routes = build(stubUpdater({
    status: async () => {
      throw new Error('boom')
    },
  }))
  const response = await routes.get('/api/stream-polish/update').fetch(new Request('http://x/api/stream-polish/update'))
  assert.equal(response.status, 500)
  assert.deepEqual(await response.json(), { ok: false, error: 'operation-failed', message: 'boom' })
})


test('translation capabilities report the mounted service and request limit', async () => {
  const unavailable = build(stubUpdater())
  const missing = await unavailable.get('/api/stream-polish/translation')
    .fetch(new Request('http://x/api/stream-polish/translation'))
  const missingBody = await missing.json()
  assert.equal(missingBody.ok, true)
  assert.equal(missingBody.available, false)
  assert.equal(missingBody.maxTextChars, 4000, 'the fallback limit is still published')

  const available = build(stubUpdater(), undefined, { translator: stubTranslator() })
  const ready = await available.get('/api/stream-polish/translation')
    .fetch(new Request('http://x/api/stream-polish/translation'))
  const readyBody = await ready.json()
  assert.equal(readyBody.available, true)
  assert.equal(readyBody.maxTextChars, 40)
  assert.deepEqual(readyBody.providers, ['bing', 'google'])
  assert.equal(readyBody.defaultTargetLanguage, 'zh-CN')
  assert.equal(readyBody.timeoutMs, 8000)
})

test('translation forwards one bounded fragment and never echoes it on failure', async () => {
  const seen = []
  const routes = build(stubUpdater(), undefined, {
    translator: stubTranslator({
      translate: async (spec) => {
        seen.push(spec)
        return '译文'
      },
    }),
  })
  const ok = await routes.get('/api/stream-polish/translate').fetch(new Request('http://x/api/stream-polish/translate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'hello', targetLanguage: 'zh-CN', provider: 'bing', sessionId: 'session-abc' }),
  }))
  assert.deepEqual(await ok.json(), { ok: true, text: '译文' })
  assert.equal(seen[0].text, 'hello')
  assert.equal(seen[0].targetLanguage, 'zh-CN')
  assert.equal(seen[0].provider, 'bing')
  assert.equal(seen[0].sessionId, 'session-abc')

  const failedRoutes = build(stubUpdater(), undefined, {
    translator: stubTranslator({
      translate: async () => {
        const error = new Error('provider said secret source text')
        error.code = 'TRANSLATION_HTTP_FAILURE'
        throw error
      },
    }),
  })
  const failed = await failedRoutes.get('/api/stream-polish/translate').fetch(new Request('http://x/api/stream-polish/translate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'secret source text', targetLanguage: 'zh-CN' }),
  }))
  const body = await failed.json()
  assert.deepEqual(body, { ok: false, code: 'PROVIDER_FAILED', retryable: true })
  assert.equal(JSON.stringify(body).includes('secret'), false)
})

test('translation rejects invalid and oversized input before dispatch', async () => {
  let calls = 0
  const routes = build(stubUpdater(), undefined, {
    translator: stubTranslator({
      translate: async () => {
        calls += 1
        return 'x'
      },
    }),
  })
  const post = (body) => routes.get('/api/stream-polish/translate').fetch(new Request('http://x/api/stream-polish/translate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }))

  assert.deepEqual(await (await post('{not json')).json(), { ok: false, code: 'BAD_REQUEST', retryable: false })
  assert.deepEqual(await (await post({ text: '' })).json(), { ok: false, code: 'BAD_REQUEST', retryable: false })
  assert.deepEqual(await (await post({ text: 'x'.repeat(41) })).json(),
    { ok: false, code: 'TEXT_LIMIT', retryable: false, maxTextChars: 40 })
  assert.deepEqual(await (await post({ text: 'x', provider: 'deepl' })).json(),
    { ok: false, code: 'BAD_PROVIDER', retryable: false })
  assert.deepEqual(await (await post({ text: 'x', targetLanguage: 'not a tag!' })).json(),
    { ok: false, code: 'BAD_LANGUAGE', retryable: false })
  assert.equal(calls, 0)
})

test('a missing translator answers UNAVAILABLE without throwing', async () => {
  const routes = build(stubUpdater())
  const response = await routes.get('/api/stream-polish/translate').fetch(new Request('http://x/api/stream-polish/translate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'hello' }),
  }))
  assert.deepEqual(await response.json(), { ok: false, code: 'UNAVAILABLE', retryable: false })
})

test('timeout and abort map to TIMEOUT; text limits keep their own code', async () => {
  const timeoutRoutes = build(stubUpdater(), undefined, {
    translator: stubTranslator({
      translate: async () => {
        const error = new Error('timed out')
        error.name = 'TimeoutError'
        throw error
      },
    }),
  })
  const timedOut = await timeoutRoutes.get('/api/stream-polish/translate').fetch(new Request('http://x/api/stream-polish/translate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'hello' }),
  }))
  assert.deepEqual(await timedOut.json(), { ok: false, code: 'TIMEOUT', retryable: true })
})
