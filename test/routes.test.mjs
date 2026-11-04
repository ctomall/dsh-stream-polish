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
function build(updater, onUpgraded) {
  const routes = createRoutes({ updater, onUpgraded })
  return new Map(routes.map((route) => [route.path, route]))
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
  ])
  assert.deepEqual(routes.get('/api/stream-polish/info').methods, ['GET'])
  assert.deepEqual(routes.get('/api/stream-polish/update').methods, ['GET'])
  assert.deepEqual(routes.get('/api/stream-polish/update/apply').methods, ['POST'])
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
