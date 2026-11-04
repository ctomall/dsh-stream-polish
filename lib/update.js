/**
 * One-click Git upgrade for the Stream polish bundle.
 *
 * The plugin lives in a `link:` directory that is also a git work tree, so an
 * upgrade is a fetch plus a fast-forward: no package manager, no reinstall.
 * After the work tree moves, the Host half asks the Loader to recompose the
 * profile, which is the documented path that replaces a linked package whose
 * files changed on disk.
 *
 * Safety rules, in order:
 *  - never touch a work tree that is not the plugin's own;
 *  - refuse a detached HEAD, a dirty work tree, and any non-fast-forward move;
 *  - validate the checked-out manifest after the move and roll back on failure.
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Bounded read-only git calls; a hung fetch must not pin a request. */
const READ_TIMEOUT_MS = 25_000
/** Bounded fast-forward; a slow link still gets one minute. */
const APPLY_TIMEOUT_MS = 90_000
/** How far up from the plugin directory to look for the work tree. */
const MAX_DEPTH = 6

/**
 * Run git inside one directory.
 * @param {string} cwd - work tree known to contain a checkout.
 * @param {string[]} args - arguments after `-C`.
 * @param {number} [timeout] - timeout in milliseconds.
 * @returns {Promise<string>} trimmed stdout.
 */
async function git(cwd, args, timeout = READ_TIMEOUT_MS) {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], {
    timeout,
    maxBuffer: 8 * 1024 * 1024,
  })
  return stdout.trim()
}

/**
 * Read one error as a short message.
 * @param {unknown} error - thrown value.
 * @returns {string} message text.
 */
function messageOf(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Find the git work tree containing a directory.
 * @param {string} start - directory to start from.
 * @returns {string | undefined} the work tree root.
 */
export function findGitRoot(start) {
  let current = start
  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    if (existsSync(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
  return undefined
}

/**
 * Read a manifest next to a directory.
 * @param {string} directory - package directory.
 * @returns {Promise<Record<string, unknown>>} parsed manifest.
 */
async function readManifest(directory) {
  return JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
}

/**
 * Express the plugin directory as a path inside the work tree, in git's form.
 * @param {string} repo - work tree root.
 * @param {string} directory - package directory.
 * @returns {string} repository-relative path with forward slashes.
 */
function repoPath(repo, directory) {
  const rel = relative(repo, directory)
  return rel.split(sep).join('/')
}

/**
 * Build the upgrade manager bound to one plugin directory.
 * @param {{ packageDir: string, remote?: string, logger?: { info?: Function, warn?: Function } }} options - manager options.
 * @returns {{ info: () => Promise<object>, status: () => Promise<object>, apply: () => Promise<object> }} the manager.
 */
export function createUpdater({ packageDir, remote = 'origin', logger }) {
  /**
   * Cheap local facts; never touches the network, so the settings page can
   * paint before any remote call.
   * @returns {Promise<object>} version and commit of the checkout.
   */
  async function info() {
    const manifest = await readManifest(packageDir).catch(() => ({}))
    const repo = findGitRoot(packageDir)
    if (repo === undefined) {
      return { ok: true, version: manifest.version ?? null, commit: null, subject: null, branch: null, git: false }
    }
    try {
      const commit = await git(repo, ['rev-parse', 'HEAD'])
      const subject = await git(repo, ['log', '-1', '--format=%s'])
      const branch = await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])
      return {
        ok: true,
        version: typeof manifest.version === 'string' ? manifest.version : null,
        name: typeof manifest.name === 'string' ? manifest.name : null,
        commit,
        shortCommit: commit.slice(0, 7),
        subject,
        branch,
        git: true,
      }
    } catch (error) {
      return { ok: false, error: 'git-unavailable', message: messageOf(error) }
    }
  }

  /**
   * Fetch the configured remote and compare the checkout with its upstream.
   * @returns {Promise<object>} status, or a failure carrying its reason.
   */
  async function status() {
    const local = await info()
    if (local.ok === false) return local

    const repo = findGitRoot(packageDir)
    if (repo === undefined) {
      return { ok: false, error: 'not-a-repository', message: '插件目录不在 git 工作区中，无法在线升级' }
    }

    try {
      const branch = await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])
      if (branch === 'HEAD') {
        return { ok: false, error: 'detached-head', message: '当前处于 detached HEAD，无法自动升级' }
      }
      const remoteUrl = await git(repo, ['remote', 'get-url', remote])
      const upstream = await git(repo, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])

      await git(repo, ['fetch', '--prune', remote])

      const behind = Number(await git(repo, ['rev-list', '--count', 'HEAD..' + upstream]))
      const ahead = Number(await git(repo, ['rev-list', '--count', upstream + '..HEAD']))
      const dirty = (await git(repo, ['status', '--porcelain', '--untracked-files=no'])).length > 0
      const latestCommit = await git(repo, ['rev-parse', upstream])
      const latestSubject = await git(repo, ['log', '-1', '--format=%s', upstream])
      const rel = repoPath(repo, packageDir)
      const manifestPath = rel === '' ? 'package.json' : rel + '/package.json'
      let latestVersion = null
      try {
        const upstreamManifest = JSON.parse(await git(repo, ['show', upstream + ':' + manifestPath]))
        if (typeof upstreamManifest.name === 'string' && upstreamManifest.name !== local.name) {
          return {
            ok: false,
            error: 'name-changed',
            message: '上游包名 ' + upstreamManifest.name + ' 与已安装的 ' + String(local.name) + ' 不一致，已中止',
          }
        }
        if (typeof upstreamManifest.version === 'string') latestVersion = upstreamManifest.version
      } catch (error) {
        return { ok: false, error: 'manifest-unreadable', message: '无法读取上游 package.json：' + messageOf(error) }
      }

      return {
        ok: true,
        name: local.name,
        version: local.version,
        commit: local.commit,
        shortCommit: local.shortCommit,
        subject: local.subject,
        branch,
        remote,
        remoteUrl,
        upstream,
        behind,
        ahead,
        dirty,
        latestVersion,
        latestCommit,
        latestShortCommit: latestCommit.slice(0, 7),
        latestSubject,
        available: behind > 0,
      }
    } catch (error) {
      return { ok: false, error: 'fetch-failed', message: '无法从 ' + remote + ' 获取更新：' + messageOf(error) }
    }
  }

  /**
   * Fast-forward to the upstream head, validating the checkout afterwards.
   * @returns {Promise<object>} the outcome; a failure carries its reason and the
   *   commit the work tree was restored to.
   */
  async function apply() {
    const before = await status()
    if (before.ok === false) return before
    if (before.available !== true) {
      return { ok: true, changed: false, message: '已是最新版本', version: before.version, commit: before.commit }
    }
    if (before.dirty === true) {
      return {
        ok: false,
        error: 'dirty-worktree',
        message: '插件目录有未提交改动，已中止升级；请先提交或 stash 后再试',
      }
    }
    if (before.ahead > 0) {
      return {
        ok: false,
        error: 'diverged',
        message: '本地分支有 ' + before.ahead + ' 个未推送提交，无法快进；请先处理这些提交',
      }
    }

    const repo = findGitRoot(packageDir)
    const head = await git(repo, ['rev-parse', 'HEAD'])
    try {
      await git(repo, ['merge', '--ff-only', before.upstream], APPLY_TIMEOUT_MS)
      const installed = await readManifest(packageDir)
      if (installed.name !== before.name) {
        throw new Error('升级后包名变为 ' + String(installed.name))
      }
      if (typeof installed.version !== 'string' || installed.version.length === 0) {
        throw new Error('升级后 package.json 缺少 version')
      }
      const commit = await git(repo, ['rev-parse', 'HEAD'])
      const summary = {
        ok: true,
        changed: true,
        from: { version: before.version, commit: before.commit },
        to: { version: installed.version, commit, shortCommit: commit.slice(0, 7), subject: before.latestSubject },
        commits: before.behind,
      }
      logger?.info?.('[' + '@local/stream-polish' + '] upgraded ' + String(before.version) + ' -> '
        + installed.version + ' (' + commit.slice(0, 7) + ')')
      return summary
    } catch (error) {
      await git(repo, ['reset', '--hard', head]).catch(() => {})
      logger?.warn?.('[@local/stream-polish] upgrade failed and was rolled back: ' + messageOf(error))
      return {
        ok: false,
        error: 'apply-failed',
        message: '升级失败，已回滚到 ' + head.slice(0, 7) + '：' + messageOf(error),
        commit: head,
      }
    }
  }

  return { info, status, apply }
}
