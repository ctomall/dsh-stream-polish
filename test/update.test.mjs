// One-click Git upgrade tests against real repositories.
//
// A temporary bare origin plus two clones reproduce every path the settings
// page can hit: up to date, behind, dirty, diverged, renamed upstream, and a
// directory that is not a work tree at all. No network access is involved.
//
//   node --test test/update.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { createUpdater, findGitRoot } from '../lib/update.js'

const execFileAsync = promisify(execFile)

const IDENTITY = ['-c', 'user.name=Stream Polish Test', '-c', 'user.email=sp-test@example.invalid']
const MANIFEST = {
  name: '@local/stream-polish',
  version: '1.1.0',
  private: true,
  type: 'module',
  exports: { '.': './index.js' },
}

/**
 * Run git and return stdout.
 * @param {string} cwd - working directory.
 * @param {string[]} args - git arguments.
 * @returns {Promise<string>} trimmed stdout.
 */
async function git(cwd, args) {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], { maxBuffer: 8 * 1024 * 1024 })
  return stdout.trim()
}

/**
 * Write the plugin manifest into a directory.
 * @param {string} directory - target.
 * @param {Record<string, unknown>} manifest - manifest body.
 * @returns {Promise<void>} resolves once written.
 */
async function writeManifest(directory, manifest) {
  await writeFile(join(directory, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
  await writeFile(join(directory, 'index.js'), 'export function apply() {}\n')
}

/**
 * Build an origin plus a source clone and an installed plugin clone.
 * @returns {Promise<{ root: string, bare: string, source: string, plugin: string }>} the fixture.
 */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'stream-polish-git-'))
  const bare = join(root, 'origin.git')
  const source = join(root, 'source')
  const plugin = join(root, 'plugin')

  await execFileAsync('git', ['init', '--bare', '--initial-branch=main', bare])
  await execFileAsync('git', ['clone', bare, source])
  await writeManifest(source, MANIFEST)
  await git(source, ['add', '-A'])
  await git(source, [...IDENTITY, 'commit', '-m', 'feat: initial import of stream-polish plugin (1.1.0)'])
  await git(source, ['push', '-u', 'origin', 'main'])

  await execFileAsync('git', ['clone', bare, plugin])
  return { root, bare, source, plugin }
}

/**
 * Add one upstream commit that bumps the version.
 * @param {{ source: string }} repo - fixture.
 * @param {string} version - new version.
 * @param {string} subject - commit subject.
 * @returns {Promise<void>} resolves once pushed.
 */
async function publish(repo, version, subject) {
  await writeManifest(repo.source, { ...MANIFEST, version })
  await git(repo.source, ['add', '-A'])
  await git(repo.source, [...IDENTITY, 'commit', '-m', subject])
  await git(repo.source, ['push', 'origin', 'main'])
}

test('info reads the checkout without touching the network', async () => {
  const repo = await fixture()
  const updater = createUpdater({ packageDir: repo.plugin })
  const info = await updater.info()
  assert.equal(info.ok, true)
  assert.equal(info.version, '1.1.0')
  assert.equal(info.name, '@local/stream-polish')
  assert.equal(info.branch, 'main')
  assert.equal(info.git, true)
  assert.equal(info.commit.length, 40)
  assert.equal(info.shortCommit.length, 7)
  assert.match(info.subject, /initial import/)
  assert.equal(findGitRoot(repo.plugin), repo.plugin)
})

test('a directory outside a work tree reports why it cannot upgrade', async () => {
  const alone = await mkdtemp(join(tmpdir(), 'stream-polish-plain-'))
  await mkdir(join(alone, 'nested'))
  const updater = createUpdater({ packageDir: join(alone, 'nested') })
  const status = await updater.status()
  assert.equal(status.ok, false)
  assert.equal(status.error, 'not-a-repository')
  assert.match(status.message, /git/)
})

test('status reports an available fast-forward and applies it', async () => {
  const repo = await fixture()
  await publish(repo, '1.2.0', 'feat: one-click git upgrade')
  const updater = createUpdater({ packageDir: repo.plugin })

  const status = await updater.status()
  assert.equal(status.ok, true)
  assert.equal(status.available, true)
  assert.equal(status.behind, 1)
  assert.equal(status.ahead, 0)
  assert.equal(status.dirty, false)
  assert.equal(status.version, '1.1.0')
  assert.equal(status.latestVersion, '1.2.0')
  assert.match(status.latestSubject, /one-click/)

  const applied = await updater.apply()
  assert.equal(applied.ok, true)
  assert.equal(applied.changed, true)
  assert.equal(applied.from.version, '1.1.0')
  assert.equal(applied.to.version, '1.2.0')
  assert.equal(applied.commits, 1)

  const manifest = JSON.parse(await readFile(join(repo.plugin, 'package.json'), 'utf8'))
  assert.equal(manifest.version, '1.2.0')
  assert.equal(await git(repo.plugin, ['rev-parse', 'HEAD']), applied.to.commit)

  const again = await updater.apply()
  assert.equal(again.ok, true)
  assert.equal(again.changed, false)
  assert.match(again.message, /最新/)
})

test('a dirty work tree is refused before anything moves', async () => {
  const repo = await fixture()
  await publish(repo, '1.2.0', 'feat: next')
  await writeFile(join(repo.plugin, 'index.js'), 'export function apply() { /* local edit */ }\n')

  const updater = createUpdater({ packageDir: repo.plugin })
  const status = await updater.status()
  assert.equal(status.dirty, true)

  const head = await git(repo.plugin, ['rev-parse', 'HEAD'])
  const applied = await updater.apply()
  assert.equal(applied.ok, false)
  assert.equal(applied.error, 'dirty-worktree')
  assert.equal(await git(repo.plugin, ['rev-parse', 'HEAD']), head, 'the checkout never moved')
})

test('local commits block the fast-forward instead of being rewritten', async () => {
  const repo = await fixture()
  await git(repo.plugin, ['config', 'user.name', 'Local'])
  await git(repo.plugin, ['config', 'user.email', 'local@example.invalid'])
  await writeFile(join(repo.plugin, 'local.txt'), 'local\n')
  await git(repo.plugin, ['add', '-A'])
  await git(repo.plugin, ['commit', '-m', 'local work'])
  await publish(repo, '1.2.0', 'feat: upstream moves on')

  const updater = createUpdater({ packageDir: repo.plugin })
  const status = await updater.status()
  assert.equal(status.ahead, 1)
  assert.equal(status.behind, 1)

  const applied = await updater.apply()
  assert.equal(applied.ok, false)
  assert.equal(applied.error, 'diverged')
  assert.match(applied.message, /1 个未推送提交/)
})

test('an upstream package rename is refused', async () => {
  const repo = await fixture()
  await writeManifest(repo.source, { ...MANIFEST, name: '@local/stream-polish-next', version: '1.2.0' })
  await git(repo.source, ['add', '-A'])
  await git(repo.source, [...IDENTITY, 'commit', '-m', 'refactor: rename'])
  await git(repo.source, ['push', 'origin', 'main'])

  const updater = createUpdater({ packageDir: repo.plugin })
  const status = await updater.status()
  assert.equal(status.ok, false)
  assert.equal(status.error, 'name-changed')
  assert.match(status.message, /@local\/stream-polish-next/)
})

test('a missing remote is reported, never thrown', async () => {
  const repo = await fixture()
  await git(repo.plugin, ['remote', 'remove', 'origin'])
  const updater = createUpdater({ packageDir: repo.plugin })
  const status = await updater.status()
  assert.equal(status.ok, false)
  assert.equal(status.error, 'fetch-failed')
})
