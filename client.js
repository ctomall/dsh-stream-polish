/**
 * Stream polish, Client half.
 *
 * Three surfaces:
 *  - a soft fade for markdown blocks while an Assistant reply streams, plus a
 *    breathing caret that fades out when the reply settles;
 *  - a compact run capsule above the composer that names the current phase,
 *    counts elapsed time, and calls out stretches with no new output;
 *  - a settings page inside Settings -> Plugins that edits every option live
 *    and hosts the one-click Git upgrade of this bundle.
 *
 * It touches no renderer state, no Session data, and no host code beyond the
 * authenticated `/api/stream-polish` routes. Selectors use the stable
 * attributes the Chat publishes (`data-streaming`, `data-tool`, `data-state`,
 * `data-chat-flow`, `data-chat-running`), never hashed CSS-module class names.
 *
 * Settings are resolved once into one store: defaults -> row config published
 * by the Host half -> this browser's saved overrides -> the
 * `__DSH_SP_STALL_MS__` test hook. The settings page writes the third layer, so
 * a change applies immediately and survives a reload without a source edit.
 */
window.__ModuleLoader__.load({
  id: '@local/stream-polish',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace owned by the run capsule and the settings page. */
    const NS = 'streamPolish'

    /** Attribute the plugin adds while a settled caret fades out. */
    const SETTLE_ATTR = 'data-dsh-sp-settling'

    /** Matches the text tail that owns the caret. */
    const CARET_TARGET = [
      ':scope > div > div:last-child > :is(p,h1,h2,h3,h4,h5,h6):last-child',
      ':scope > div > div:last-child > :is(ul,ol):last-child > li:last-child',
      ':scope > div > div:last-child > blockquote:last-child > p:last-child',
    ].join(',')

    /** Global the Host half publishes this row's configuration on. */
    const GLOBAL_NAME = '__DSH_STREAM_POLISH__'

    /** Wire shape version this half understands. */
    const WIRE_VERSION = 2

    /** localStorage key holding this browser's overrides. */
    const STORAGE_KEY = 'dsh.stream-polish.settings'

    /** Prefix every diagnostic line carries. */
    const PREFIX = '[@local/stream-polish] '
    /** This bundle's package name; also the key of its configuration page. */
    const PACKAGE = '@local/stream-polish'

    /** Diagnostic levels, quiet to loud. Mirrors `config.js`. */
    const LOG_LEVELS = ['silent', 'error', 'warn', 'info', 'debug']

    /** Rank of each diagnostic level. */
    const LEVEL_RANK = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 }

    /**
     * Mirror of `SPEC` in `config.js`.
     *
     * A plain script cannot import ESM, so the table is repeated here;
     * `test/client.test.mjs` fails when the mirror and `config.js` disagree, so
     * the duplication cannot rot. `summary` is documentation-only and lives in
     * `config.js`.
     */
    const SPEC = {
      enabled: { type: 'boolean', default: true },
      blockFade: { type: 'boolean', default: true },
      blockFadeMs: { type: 'integer', default: 160, min: 80, max: 600 },
      caret: { type: 'boolean', default: true },
      caretPeriodMs: { type: 'integer', default: 1200, min: 400, max: 4000 },
      settleFade: { type: 'boolean', default: true },
      settleMs: { type: 'integer', default: 260, min: 100, max: 1000 },
      stallMs: { type: 'integer', default: 15000, min: 500, max: 600000 },
      runStrip: { type: 'boolean', default: true },
      showElapsed: { type: 'boolean', default: true },
      showActivity: { type: 'boolean', default: true },
      logLevel: { type: 'enum', default: 'warn', values: LOG_LEVELS },
    }

    /** Accepted defaults, derived from the mirror above. */
    const DEFAULTS = {}
    for (const [key, rule] of Object.entries(SPEC)) DEFAULTS[key] = rule.default

    /** Option names, in documentation order. */
    const KEYS = Object.keys(SPEC)

    /**
     * Read the mirror rule for one option.
     * @param {string} key - option name.
     * @returns {object | undefined} the rule.
     */
    function ruleFor(key) {
      return Object.prototype.hasOwnProperty.call(SPEC, key) ? SPEC[key] : undefined
    }

    /**
     * Describe what a key accepts; identical text to `config.js`.
     * @param {string} key - option name.
     * @returns {string} a human-readable expectation.
     */
    function expectationOf(key) {
      const rule = ruleFor(key)
      if (rule === undefined) return 'a known option'
      if (rule.type === 'boolean') return 'a boolean (true or false)'
      if (rule.type === 'integer') return 'an integer between ' + rule.min + ' and ' + rule.max
      return 'one of ' + (rule.values ?? []).map((value) => '"' + value + '"').join(' | ')
    }

    /**
     * Render a received value the way an error message shows it.
     * @param {unknown} value - rejected value.
     * @returns {string} quoted strings, bare numbers, JSON for objects.
     */
    function showValue(value) {
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
     * @returns {boolean} true when usable as-is.
     */
    function isValid(key, value) {
      const rule = ruleFor(key)
      if (rule === undefined) return false
      if (rule.type === 'boolean') return typeof value === 'boolean'
      if (rule.type === 'integer') return Number.isInteger(value) && value >= rule.min && value <= rule.max
      return typeof value === 'string' && (rule.values ?? []).includes(value)
    }

    /**
     * Build the one message a rejected value produces; same text as `config.js`.
     * @param {string} key - option name.
     * @param {unknown} value - rejected value.
     * @returns {string} the message, without the log prefix.
     */
    function issueMessage(key, value) {
      const rule = ruleFor(key)
      if (rule === undefined) return 'config.' + key + ' is not a recognized option (ignored).'
      return 'config.' + key + ' must be ' + expectationOf(key) + '; got ' + showValue(value)
        + '; using ' + showValue(rule.default) + '.'
    }

    /**
     * Read the accepted config the Host half published for this page load.
     * @returns {Record<string, unknown> | undefined} the row config, when present and current.
     */
    function readWire() {
      try {
        const wire = globalThis[GLOBAL_NAME]
        if (wire === null || typeof wire !== 'object') return undefined
        if (wire.version !== WIRE_VERSION) return undefined
        const config = wire.config
        return config !== null && typeof config === 'object' && !Array.isArray(config) ? config : undefined
      } catch {
        return undefined
      }
    }

    /**
     * Read this browser's saved overrides.
     * @returns {unknown} the stored object, or undefined when absent or unreadable.
     */
    function readSaved() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        return raw === null ? undefined : JSON.parse(raw)
      } catch {
        return undefined
      }
    }

    /**
     * Fold one source over the accumulating settings.
     * @param {Record<string, unknown>} target - settings being built.
     * @param {unknown} source - candidate values.
     * @param {Array<{ key: string, message: string }>} issues - collector.
     * @param {string} origin - `host` or `saved`, for the message.
     * @returns {void}
     */
    function accept(target, source, issues, origin) {
      if (source === undefined || source === null) return
      if (typeof source !== 'object' || Array.isArray(source)) {
        issues.push({
          key: '',
          message: (origin === 'saved' ? 'saved overrides in localStorage' : 'host config')
            + ' must be a mapping of option names to values; got ' + showValue(source) + '; ignored.',
        })
        return
      }
      for (const [key, value] of Object.entries(source)) {
        if (ruleFor(key) === undefined) {
          issues.push({ key, message: issueMessage(key, value) })
          continue
        }
        if (isValid(key, value)) {
          target[key] = value
          continue
        }
        issues.push({ key, message: issueMessage(key, value) })
      }
    }

    /**
     * Resolve the two lower layers: the row's own defaults and this browser's
     * saved overrides. The test hook is applied on top of both.
     * @returns {{ baseline: Record<string, unknown>, saved: Record<string, unknown>, issues: Array<{ key: string, message: string }> }} the layers.
     */
    function resolveLayers() {
      const baseline = {}
      for (const key of KEYS) baseline[key] = DEFAULTS[key]
      const issues = []
      accept(baseline, readWire(), issues, 'host')

      // The saved layer starts neutral, so an unusable saved key leaves the row
      // default in place instead of re-reporting the host value.
      const saved = {}
      accept(saved, readSaved(), issues, 'saved')

      if (!LOG_LEVELS.includes(saved.logLevel)) delete saved.logLevel
      if (!LOG_LEVELS.includes(baseline.logLevel)) baseline.logLevel = DEFAULTS.logLevel
      return { baseline, saved, issues }
    }

    /**
     * Write the saved layer: only the keys this browser changed.
     * @param {Record<string, unknown>} value - current settings.
     * @param {Record<string, unknown>} baseline - the row's own defaults.
     * @returns {void}
     */
    function persist(value, baseline) {
      const diff = {}
      for (const key of KEYS) {
        if (value[key] !== baseline[key]) diff[key] = value[key]
      }
      try {
        if (Object.keys(diff).length === 0) window.localStorage.removeItem(STORAGE_KEY)
        else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(diff))
      } catch {
        // A refused write only loses persistence; the in-memory value still applies.
      }
    }

    /**
     * Build the one observable settings store every surface reads.
     * @param {Record<string, unknown>} baseline - row defaults plus the test hook.
     * @param {Record<string, unknown>} saved - this browser's overrides.
     * @returns {object} the store.
     */
    function createSettingsStore(baseline, saved) {
      let value = { ...baseline, ...saved }
      const listeners = new Set()
      const emit = () => {
        for (const listener of [...listeners]) {
          try {
            listener()
          } catch (error) {
            console.error(PREFIX + 'settings listener failed: ' + String(error))
          }
        }
      }
      return {
        get: () => value,
        baseline: () => baseline,
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        isDefault() {
          return KEYS.every((key) => value[key] === baseline[key])
        },
        /**
         * Apply the keys that are both known and valid; returns whether anything moved.
         * @param {Record<string, unknown>} patch - candidate values.
         * @returns {boolean} true when the store changed.
         */
        update(patch) {
          const next = { ...value }
          let changed = false
          for (const [key, candidate] of Object.entries(patch)) {
            if (!isValid(key, candidate) || next[key] === candidate) continue
            next[key] = candidate
            changed = true
          }
          if (!changed) return false
          value = next
          persist(value, baseline)
          emit()
          return true
        },
        /** Drop this browser's overrides so the row config applies again. */
        reset() {
          value = { ...baseline }
          persist(value, baseline)
          emit()
        },
      }
    }

    const layers = resolveLayers()

    // The test hook is a launch-time override of `stallMs`; it still wins over
    // every layer, and is deliberately not range-checked because a harness needs
    // a stall that arrives in under a second.
    const hook = Number(globalThis.__DSH_SP_STALL_MS__)
    if (Number.isFinite(hook) && hook > 0) {
      layers.baseline.stallMs = Math.round(hook)
      delete layers.saved.stallMs
    }

    const store = createSettingsStore(layers.baseline, layers.saved)

    /** Bound translator, set in `apply`; used when a slot omits `t`. */
    let translate = (key) => key

    /** Write one diagnostic line, unless `logLevel` is quieter than `level`. */
    function logAt(level, method, text) {
      const rank = LEVEL_RANK[store.get().logLevel] ?? LEVEL_RANK.warn
      if (rank < LEVEL_RANK[level]) return
      const sink = typeof console[method] === 'function' ? console[method] : console.log
      sink.call(console, PREFIX + text)
    }

    for (const issue of layers.issues) logAt('warn', 'warn', issue.message)
    logAt('info', 'info', 'configuration resolved'
      + (layers.issues.length === 0 ? '' : ' with ' + layers.issues.length + ' issue(s)'))
    logAt('debug', 'debug', 'resolved config ' + JSON.stringify(store.get()))

    /**
     * Debug surface: the store, the table it validates against, and the issues
     * collected on this load. Tests read it to prove the mirror matches
     * `config.js` and to drive the settings page without a browser.
     */
    globalThis.__DSH_STREAM_POLISH_CLIENT__ = {
      version: WIRE_VERSION,
      spec: SPEC,
      defaults: DEFAULTS,
      issues: layers.issues,
      store,
    }

    /** Subscribe a component to the settings store. */
    function useSettings() {
      const [, bump] = React.useState(0)
      React.useEffect(() => store.subscribe(() => bump((value) => value + 1)), [])
      return store.get()
    }

    /** Tool titles that a running command row may show as its first line. */
    const TOOL_TITLES = new Set(['Bash', 'Read', 'Write', 'Edit', 'Grep', 'Glob', 'Web search', 'Web fetch', 'Subagent', 'Workflow', 'Plugin', 'Task', 'Job', 'Schedule', 'Ask user', 'Present', 'Goal'])

    /** Simplified Chinese copy. */
    const zh = {
      'phase.thinking': '思考中',
      'phase.writing': '正在写回答',
      'phase.tool': '运行 {tool}',
      'phase.commands': '运行命令',
      'phase.tools': '运行 {n} 个工具',
      'activity.now': '最近活动 <2s',
      'activity.seconds': '{n}s 前有活动',
      'activity.minutes': '{m}m {n}s 前有活动',
      'stall': '{n}s 无新输出',
      'aria': '{phase}，已用 {elapsed}，{activity}',
      tab: '流式输出美化',
      'settings.title': '流式输出美化',
      'settings.intro': '下面的开关立即生效，并只保存在本浏览器；默认值来自插件在档案里的配置。',
      'settings.display': '显示',
      'settings.displayNote': '正文与胶囊',
      'settings.timing': '时长',
      'settings.timingNote': '单位毫秒',
      'settings.log': '诊断',
      'settings.enabled': '总开关',
      'settings.enabledHint': '关闭后不挂载样式、观察器和运行胶囊',
      'settings.blockFade': '块淡入',
      'settings.blockFadeHint': '流式期间新出现的段落、列表和代码块淡入',
      'settings.caret': '呼吸光标',
      'settings.caretHint': '正在书写的末尾显示一枚呼吸竖线',
      'settings.settleFade': '落定淡出',
      'settings.settleFadeHint': '回复落定时光标淡出，而不是直接消失',
      'settings.runStrip': '运行胶囊',
      'settings.runStripHint': '输入框上方显示阶段、已用时长和最近活动',
      'settings.showElapsed': '显示已用时长',
      'settings.showElapsedHint': '胶囊里保留 mm:ss 计时',
      'settings.showActivity': '显示最近活动',
      'settings.showActivityHint': '胶囊里保留活动 / 停滞文案',
      'settings.blockFadeMs': '块淡入时长',
      'settings.caretPeriodMs': '光标呼吸周期',
      'settings.settleMs': '落定淡出时长',
      'settings.stallMs': '停滞判定阈值',
      'settings.logLevel': '日志级别',
      'settings.logLevelHint': '合法配置下默认完全静默',
      'settings.reset': '恢复默认',
      'settings.resetHint': '清除本浏览器的覆盖值',
      'settings.footHint': '改动立即生效；要成为所有浏览器的默认值，请改档案里的 cordis.patch.yml。',
      'settings.range': '{min}–{max} 毫秒',
      'settings.loading': '读取版本…',
      'settings.version': '版本 {version}',
      'settings.commit': '提交 {commit}',
      'settings.badgeLocal': '本浏览器已改动',
      'preview.title': '预览',
      'preview.replay': '重播',
      'preview.hint': '下面是用当前配置实时重放的片段，改任何一项都会立刻反映出来。',
      'preview.settled': '已经在屏幕上的段落不会重播动画。',
      'preview.fading': '新出现的段落按 {ms}ms 淡入。',
      'preview.caret': '最后一行带着呼吸光标',
      'preview.off': '装饰已关闭。打开「总开关」后这里会显示预览。',
      'preview.noCapsule': '运行胶囊已关闭。',
      'preview.phase': '正在写回答',
      'preview.elapsed': '00:12',
      'preview.activity': '最近活动 <2s',
      update: '在线升级',
      'update.title': '在线升级',
      'update.intro': '从 git 远端快进到最新提交。有未提交改动或本地领先时会拒绝，失败会自动回滚。',
      'update.check': '检查更新',
      'update.apply': '一键升级',
      'update.checking': '检查中…',
      'update.upgrading': '升级中…',
      'update.uptodate': '已是最新：{version}',
      'update.available': '可升级到 {version}，落后 {n} 个提交',
      'update.upgraded': '已升级到 {version}（{commit}），页面即将刷新',
      'update.reloading': '正在重载插件…',
      'update.restart': '已升级，但 Host 模块需要重启 dsh 才能加载',
      'update.failed': '无法完成升级',
      'update.noStats': 'Host 半没有提供升级接口',
      'update.current': '当前',
      'update.latest': '远端',
    }

    /** English copy. */
    const en = {
      'phase.thinking': 'Thinking',
      'phase.writing': 'Writing reply',
      'phase.tool': 'Running {tool}',
      'phase.commands': 'Running commands',
      'phase.tools': 'Running {n} tools',
      'activity.now': 'active <2s ago',
      'activity.seconds': 'active {n}s ago',
      'activity.minutes': 'active {m}m {n}s ago',
      'stall': 'no new output for {n}s',
      'aria': '{phase}, {elapsed} elapsed, {activity}',
      tab: 'Stream polish',
      'settings.title': 'Stream polish',
      'settings.intro': 'These switches apply immediately and live in this browser only; the row config in the profile supplies the defaults.',
      'settings.display': 'Display',
      'settings.displayNote': 'Transcript and capsule',
      'settings.timing': 'Timing',
      'settings.timingNote': 'Milliseconds',
      'settings.log': 'Diagnostics',
      'settings.enabled': 'Enabled',
      'settings.enabledHint': 'Off mounts no style, observer, or capsule',
      'settings.blockFade': 'Block fade',
      'settings.blockFadeHint': 'Fade paragraphs, lists, and code blocks that appear while streaming',
      'settings.caret': 'Breathing caret',
      'settings.caretHint': 'A breathing bar after the text being written',
      'settings.settleFade': 'Settle fade',
      'settings.settleFadeHint': 'Fade the caret out when the reply settles instead of dropping it',
      'settings.runStrip': 'Run capsule',
      'settings.runStripHint': 'Phase, elapsed time, and last activity above the composer',
      'settings.showElapsed': 'Show elapsed time',
      'settings.showElapsedHint': 'Keep the mm:ss counter in the capsule',
      'settings.showActivity': 'Show activity',
      'settings.showActivityHint': 'Keep the activity / stall text in the capsule',
      'settings.blockFadeMs': 'Block fade duration',
      'settings.caretPeriodMs': 'Caret breathing period',
      'settings.settleMs': 'Settle fade duration',
      'settings.stallMs': 'Stall threshold',
      'settings.logLevel': 'Log level',
      'settings.logLevelHint': 'A valid config stays silent at the default level',
      'settings.reset': 'Reset',
      'settings.resetHint': 'Clear this browser\u2019s overrides',
      'settings.footHint': 'Changes apply immediately; edit the profile cordis.patch.yml to change the defaults for every browser.',
      'settings.range': '{min}–{max} ms',
      'settings.loading': 'Reading version…',
      'settings.version': 'Version {version}',
      'settings.commit': 'Commit {commit}',
      'settings.badgeLocal': 'Changed in this browser',
      'preview.title': 'Preview',
      'preview.replay': 'Replay',
      'preview.hint': 'This snippet replays with the current settings; every control changes it immediately.',
      'preview.settled': 'A paragraph already on screen never replays its animation.',
      'preview.fading': 'A new paragraph fades in over {ms}ms.',
      'preview.caret': 'The last line carries the breathing caret',
      'preview.off': 'Decoration is off. Turn the master switch on to see the preview.',
      'preview.noCapsule': 'The run capsule is off.',
      'preview.phase': 'Writing reply',
      'preview.elapsed': '00:12',
      'preview.activity': 'active <2s ago',
      update: 'Online upgrade',
      'update.title': 'Online upgrade',
      'update.intro': 'Fast-forwards the checkout from the git remote. Refuses a dirty or diverged work tree, and rolls back on failure.',
      'update.check': 'Check for updates',
      'update.apply': 'Upgrade now',
      'update.checking': 'Checking…',
      'update.upgrading': 'Upgrading…',
      'update.uptodate': 'Up to date: {version}',
      'update.available': 'Update available: {version}, {n} commit(s) behind',
      'update.upgraded': 'Upgraded to {version} ({commit}); reloading…',
      'update.reloading': 'Reloading the plugin…',
      'update.restart': 'Upgraded, but the Host module needs a dsh restart',
      'update.failed': 'Upgrade failed',
      'update.noStats': 'The Host half exposed no upgrade route',
      'update.current': 'Current',
      'update.latest': 'Remote',
    }

    /**
     * Format a duration as mm:ss (or h:mm:ss once it passes an hour).
     * @param ms - duration in milliseconds.
     * @returns the clock label.
     */
    function clock(ms) {
      const total = Math.max(0, Math.floor(ms / 1000))
      const hours = Math.floor(total / 3600)
      const minutes = Math.floor((total % 3600) / 60)
      const seconds = total % 60
      const tail = String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0')
      return hours > 0 ? String(hours) + ':' + tail : tail
    }

    /** A bounded activity observer shared by the composer capsule. */
    function createRunStore() {
      return {
        running: false,
        sessionId: null,
        phase: 'thinking',
        tool: null,
        toolCount: 0,
        key: '',
        phaseSince: 0,
        lastActivityAt: 0,
        listeners: new Set(),
        heartbeat: null,

        subscribe(fn) {
          this.listeners.add(fn)
          return () => this.listeners.delete(fn)
        },

        emit() {
          for (const fn of this.listeners) fn()
        },

        startHeartbeat() {
          this.stopHeartbeat()
          this.heartbeat = window.setInterval(() => {
            this.syncPhase()
            this.emit()
          }, 1000)
        },

        stopHeartbeat() {
          if (this.heartbeat !== null) {
            window.clearInterval(this.heartbeat)
            this.heartbeat = null
          }
        },

        /** Stop without notifying an unmounting component. */
        stop() {
          this.running = false
          this.sessionId = null
          this.stopHeartbeat()
        },

        setRunning(running, sessionId) {
          if (this.running === running && this.sessionId === sessionId) return
          this.running = running
          this.sessionId = sessionId
          if (running) {
            this.phaseSince = Date.now()
            this.lastActivityAt = Date.now()
            this.syncPhase(true)
            this.startHeartbeat()
            this.emit()
          } else {
            this.stopHeartbeat()
            this.emit()
          }
        },

        /** Count any real Chat mutation as activity, without re-rendering per token. */
        touch() {
          if (this.running) this.lastActivityAt = Date.now()
        },

        /** Re-derive thinking / tool / writing from the Chat DOM. */
        syncPhase(force) {
          if (!this.running) return
          const flows = Array.from(document.querySelectorAll('[data-conversation-region="chat"] [data-chat-flow]'))
          const flow = flows.find((el) => el.getClientRects().length > 0) ?? flows[0]
          if (flow === undefined) return
          const tools = Array.from(flow.querySelectorAll('[data-tool][data-state="running"], [data-tool][data-state="pending"]'))
          const shimmers = Array.from(flow.querySelectorAll('[data-shimmer]')).filter((el) => (
            el.closest('[data-chat-running]') === null && el.getClientRects().length > 0
          ))
          const active = shimmers.length > 0 ? shimmers[shimmers.length - 1] : null
          const firstLine = active === null ? '' : (active.innerText || '').split('\n')[0].trim()
          const tool = tools.length > 0
            ? tools[tools.length - 1].getAttribute('data-tool')
            : firstLine === 'Running commands' || firstLine === '运行命令'
              ? 'commands'
              : TOOL_TITLES.has(firstLine)
                ? firstLine
                : null
          const writing = flow.querySelector('[data-streaming]') !== null
          const phase = tool !== null ? 'tool' : writing ? 'writing' : 'thinking'
          const key = phase + ':' + (tool ?? '')
          if (!force && key === this.key) return
          this.key = key
          this.phase = phase
          this.tool = tool
          this.toolCount = tool === null ? 0 : 1
          this.phaseSince = Date.now()
          this.lastActivityAt = Date.now()
          this.emit()
        },
      }
    }

    const runStore = createRunStore()

    /** The compact phase capsule rendered above the composer while running. */
    function RunStrip({ session, t }) {
      const settings = useSettings()
      const [, setVersion] = React.useState(0)

      React.useEffect(() => runStore.subscribe(() => setVersion((value) => value + 1)), [])

      React.useEffect(() => {
        if (session !== undefined) runStore.setRunning(session.running, session.sessionId)
      }, [session?.running, session?.sessionId])

      React.useEffect(() => () => runStore.stop(), [])

      if (!settings.enabled || !settings.runStrip) return null
      if (session === undefined || !session.running || !runStore.running || runStore.sessionId !== session.sessionId) return null

      const now = Date.now()
      const elapsed = clock(now - runStore.phaseSince)
      const idle = Math.max(0, now - runStore.lastActivityAt)
      const stalled = idle >= settings.stallMs
      const phase = runStore.phase === 'tool'
        ? runStore.tool === 'commands'
          ? t('phase.commands')
          : t('phase.tool', { tool: runStore.tool })
        : runStore.phase === 'writing'
          ? t('phase.writing')
          : t('phase.thinking')
      const activity = stalled
        ? t('stall', { n: Math.floor(idle / 1000) })
        : idle < 2000
          ? t('activity.now')
          : idle < 60000
            ? t('activity.seconds', { n: Math.floor(idle / 1000) })
            : t('activity.minutes', { m: Math.floor(idle / 60000), n: Math.floor((idle % 60000) / 1000) })

      // A hidden segment is not rendered and not read out, so the pill always
      // matches what assistive technology announces.
      const segments = [phase]
      if (settings.showElapsed) segments.push(elapsed)
      if (settings.showActivity) segments.push(activity)
      const label = settings.showElapsed && settings.showActivity
        ? t('aria', { phase, elapsed, activity })
        : segments.join(', ')

      const children = []
      children.push(h('span', { key: 'dot', className: 'dshRS_dot' }))
      segments.forEach((text, index) => {
        if (index === 0) {
          children.push(h('span', { key: 'phase', className: 'dshRS_phase' }, text))
          return
        }
        children.push(h('span', { key: 'sep' + index, className: 'dshRS_sep' }, '·'))
        children.push(h('span', {
          key: (index === 1 && settings.showElapsed ? 'time' : 'activity' + index),
          className: index === 1 && settings.showElapsed ? 'dshRS_time' : 'dshRS_activity',
        }, text))
      })

      return h('div', { className: 'dshRS_root', 'data-dsh-run-strip': '' },
        h('span', {
          className: 'dshRS_pill',
          'data-stalled': stalled ? '' : undefined,
          role: 'status',
          'aria-live': 'off',
          'aria-label': label,
        }, children),
      )
    }

    /** Selectors for the caret tail, scoped to one root prefix. */
    function caretRule(prefix) {
      const head = prefix + ' > div > div:last-child > '
      return head + ':is(p,h1,h2,h3,h4,h5,h6):last-child::after,'
        + head + ':is(ul,ol):last-child > li:last-child::after,'
        + head + 'blockquote:last-child > p:last-child::after'
    }

    /** New markdown blocks, faded in as they mount. */
    const BLOCK_RULE = '[data-streaming] > div > div > :is(p,h1,h2,h3,h4,h5,h6,pre,blockquote,table,.md-code-block,.md-table-wide),'
      + '[data-streaming] > div > div > :is(ul,ol) > li'

    /** Root selector for the breathing state; the settling state only exists
     * when a fade is configured, so a no-fade setup keeps the plain selector. */
    function caretPrefix(s) {
      return s.settleFade ? ':is([data-streaming],[' + SETTLE_ATTR + '])' : '[data-streaming]'
    }

    /** The caret's own box, independent of how long it breathes. */
    const CARET_BODY = 'content:"";display:inline-block;width:2px;height:1.05em;margin:0 -5px 0 3px;'
      + 'vertical-align:-.16em;border-radius:1px;pointer-events:none;'
      + 'background:currentColor;'
      + 'background:linear-gradient(180deg,currentColor 15%,color-mix(in srgb,currentColor 30%,transparent));'

    /**
     * Build the decoration stylesheet for one settings snapshot.
     *
     * A disabled feature contributes no rule at all, so the browser never even
     * parses the animation it was told to skip. Durations come straight from
     * the resolved config.
     * @param {Record<string, unknown>} s - current settings.
     * @returns {string} the stylesheet text ('' when every surface is off).
     */
    function buildCss(s) {
      const parts = []

      if (s.blockFade) {
        parts.push('@keyframes dshSP_blockIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}')
        parts.push(BLOCK_RULE + '{animation:dshSP_blockIn ' + s.blockFadeMs + 'ms cubic-bezier(.2,.7,.3,1)}')
      }

      if (s.caret) {
        parts.push('@keyframes dshSP_caret{0%,100%{opacity:.95}50%{opacity:.78}}')
        parts.push(caretRule(caretPrefix(s)) + '{' + CARET_BODY
          + 'animation:dshSP_caret ' + s.caretPeriodMs + 'ms ease-in-out infinite}')
        if (s.settleFade) {
          parts.push('@keyframes dshSP_caretOut{from{opacity:.95}to{opacity:0}}')
          parts.push(caretRule('[' + SETTLE_ATTR + ']') + '{animation:dshSP_caretOut '
            + s.settleMs + 'ms ease-out forwards}')
        }
      }

      if (s.blockFade || s.caret) {
        const reduced = []
        if (s.blockFade) reduced.push(BLOCK_RULE + '{animation:none}')
        if (s.caret) reduced.push(caretRule(caretPrefix(s)) + '{animation:none;opacity:.65}')
        parts.push('@media (prefers-reduced-motion:reduce){' + reduced.join('') + '}')
      }

      if (s.caret) {
        parts.push('@media (forced-colors:active){' + caretRule(caretPrefix(s))
          + '{background:CanvasText;forced-color-adjust:none}}')
      }

      if (s.runStrip) {
        // Run capsule: absolutely positioned above the resident composer, so it
        // never changes the composer height or pushes the transcript.
        parts.push('@keyframes dshRS_pulse{0%,100%{opacity:1}50%{opacity:.45}}')
        parts.push('.dshRS_root{position:absolute;left:0;right:0;bottom:calc(100% + 8px);z-index:6;display:flex;justify-content:center;pointer-events:none}')
        parts.push('.dshRS_pill{box-sizing:border-box;display:inline-flex;align-items:center;gap:7px;max-width:calc(100% - 32px);height:26px;padding:0 11px;'
          + 'border:1px solid var(--dsw-alias-border-l2);border-radius:999px;white-space:nowrap;font-variant-numeric:tabular-nums;'
          + 'color:var(--dsw-alias-label-tertiary);font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);'
          + 'line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));'
          + 'background:color-mix(in srgb,var(--dsw-alias-bg-base) 88%,transparent);'
          + 'box-shadow:0 4px 18px color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);'
          + 'backdrop-filter:blur(10px)}')
        parts.push('.dshRS_dot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-state-business-primary);animation:dshRS_pulse 1.8s ease-in-out infinite}')
        parts.push('.dshRS_phase{color:var(--dsw-alias-label-secondary);font-weight:500;overflow:hidden;text-overflow:ellipsis}')
        parts.push('.dshRS_sep{color:var(--dsw-alias-separator-primary)}')
        parts.push('.dshRS_activity{min-width:0;overflow:hidden;text-overflow:ellipsis}')
        parts.push('.dshRS_pill[data-stalled] .dshRS_dot{background:var(--dsw-alias-state-warn-primary);animation:none}')
        parts.push('.dshRS_pill[data-stalled] .dshRS_activity{color:var(--dsw-alias-state-warn-primary)}')
        parts.push('@media (prefers-reduced-motion:reduce){.dshRS_dot{animation:none}}')
        parts.push('@media (forced-colors:active){.dshRS_pill{border-color:CanvasText;background:Canvas;color:CanvasText}.dshRS_dot{background:Highlight}}')
      }

      return parts.join('')
    }

    /** Settings-page styles; mounted whether or not the decoration is enabled. */
    const PAGE_CSS = [
      '.dshSPS_page{display:flex;flex-direction:column;gap:18px;max-width:720px;color:var(--dsw-alias-label-primary)}',
      '.dshSPS_head{display:flex;flex-direction:column;gap:4px}',
      '.dshSPS_title{margin:0;font-size:15px;font-weight:600;line-height:22px}',
      '.dshSPS_intro{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}',
      '.dshSPS_meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
      '.dshSPS_badge{display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:999px;font-size:11px;line-height:20px;color:var(--dsw-alias-state-warn-primary);border:.5px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary) 45%,transparent)}',
      '.dshSPS_section{display:flex;flex-direction:column;gap:10px}',
      '.dshSPS_sectionHead{display:flex;align-items:baseline;gap:10px;min-width:0}',
      '.dshSPS_sectionTitle{margin:0;font-size:12px;font-weight:600;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.dshSPS_sectionNote{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',

      '.dshSPS_master{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 14px;border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}',
      '.dshSPS_masterText{display:flex;flex-direction:column;gap:3px;min-width:0}',
      '.dshSPS_masterTitle{font-size:14px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-primary)}',
      '.dshSPS_masterHint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',

      '.dshSPS_grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(196px,1fr));gap:10px;align-items:stretch}',
      '.dshSPS_tile{display:flex;flex-direction:column;gap:8px;padding:12px;border:.5px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-2);min-width:0}',
      '.dshSPS_tile[data-off=true]{opacity:.5}',
      '.dshSPS_tileTop{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;min-width:0}',
      '.dshSPS_tileTitle{font-size:13px;font-weight:500;line-height:18px;color:var(--dsw-alias-label-primary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshSPS_tileHint{font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary);margin-top:auto}',

      '.dshSPS_line{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 12px;border:.5px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}',
      '.dshSPS_lineText{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.dshSPS_lineTitle{font-size:13px;line-height:18px;color:var(--dsw-alias-label-primary)}',
      '.dshSPS_lineHint{font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary)}',
      '.dshSPS_lineControl{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex:none;min-width:0}',

      '.dshSPS_switch{position:relative;flex:none;width:36px;height:20px;padding:0;border:0;border-radius:999px;background:var(--dsw-alias-border-l2);appearance:none;cursor:pointer;transition:background-color .16s ease}',
      '.dshSPS_switch[data-on=true]{background:var(--dsw-alias-brand-primary)}',
      '.dshSPS_knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.28);transition:transform .16s ease}',
      '.dshSPS_switch[data-on=true] .dshSPS_knob{transform:translateX(16px)}',
      '.dshSPS_switch:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}',
      '.dshSPS_switch:disabled{cursor:default;opacity:.55}',

      '.dshSPS_seg{display:inline-flex;gap:2px;padding:2px;border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}',
      '.dshSPS_segBtn{height:24px;padding:0 9px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:12px;font-weight:500;line-height:24px;white-space:nowrap;cursor:pointer}',
      '.dshSPS_segBtn:hover{color:var(--dsw-alias-label-primary)}',
      '.dshSPS_segBtn[data-active=true]{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent)}',
      '.dshSPS_segBtn:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:-1px}',

      '.dshSPS_num{display:inline-flex;align-items:center;gap:6px}',
      '.dshSPS_input{box-sizing:border-box;width:88px;height:28px;padding:0 8px;border:.5px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;text-align:right;font-variant-numeric:tabular-nums}',
      '.dshSPS_input:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}',
      '.dshSPS_input[aria-invalid=true]{border-color:var(--dsw-alias-state-error-primary)}',
      '.dshSPS_input:disabled{cursor:default;color:var(--dsw-alias-label-tertiary)}',
      '.dshSPS_unit{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',

      '.dshSPS_foot{display:flex;flex-wrap:wrap;align-items:center;gap:12px}',
      '.dshSPS_button{height:28px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:12px;line-height:26px;cursor:pointer}',
      '.dshSPS_button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dshSPS_button:disabled{opacity:.45;cursor:default}',
      '.dshSPS_button:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}',
      '.dshSPS_button[data-primary=true]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.dshSPS_footHint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}',

      '.dshSPS_card{display:flex;flex-direction:column;gap:10px;padding:12px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-layer-2)}',
      '.dshSPS_cardHead{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px}',
      '.dshSPS_cardTitle{font-size:13px;font-weight:600;line-height:20px;color:var(--dsw-alias-label-primary)}',
      '.dshSPS_cardNote{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
      '.dshSPS_pair{display:flex;flex-wrap:wrap;gap:18px}',
      '.dshSPS_pairItem{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.dshSPS_pairKey{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}',
      '.dshSPS_pairValue{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.dshSPS_status{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.dshSPS_status[data-tone=error]{color:var(--dsw-alias-state-error-primary)}',
      '.dshSPS_status[data-tone=ok]{color:var(--dsw-alias-state-success-primary)}',
      '.dshSPS_status[data-tone=busy]{color:var(--dsw-alias-label-tertiary)}',

      '.dshSPS_preview{display:flex;flex-direction:column;gap:10px;padding:12px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-layer-2)}',
      '.dshSPS_previewBar{display:flex;align-items:center;gap:10px}',
      '.dshSPS_previewTag{font-size:12px;font-weight:600;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.dshSPS_previewHint{margin-left:auto;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);text-align:right}',
      '.dshSPS_previewBar .dshSPS_button{margin-left:auto}',
      '.dshSPS_previewStage{display:flex;flex-direction:column;gap:6px;padding-top:2px}',
      '.dshSPS_demoLine{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}',
      '.dshSPS_demoLine.dshSPS_demoIn{color:var(--dsw-alias-label-primary);animation:dshSPS_in var(--dshSPS-fade,160ms) cubic-bezier(.2,.7,.3,1)}',
      '.dshSPS_demoLine.dshSPS_demoIn[data-fade=false]{animation:none}',
      '.dshSPS_demoCaret{display:inline-block;width:2px;height:1.05em;margin:0 -1px 0 3px;border-radius:1px;vertical-align:-.16em;',
      'background:linear-gradient(180deg,currentColor 15%,color-mix(in srgb,currentColor 30%,transparent));',
      'animation:dshSPS_breath var(--dshSPS-period,1200ms) ease-in-out infinite}',
      '.dshSPS_previewNote{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
      '.dshSPS_previewEmpty{display:flex;align-items:center;justify-content:center;min-height:44px;border:.5px dashed var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;text-align:center;padding:0 10px}',
      '.dshSPS_demoPill{display:inline-flex;align-items:center;gap:7px;align-self:flex-start;max-width:100%;height:26px;padding:0 11px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;white-space:nowrap;font-variant-numeric:tabular-nums;font-size:12px;',
      'color:var(--dsw-alias-label-tertiary);background:color-mix(in srgb,var(--dsw-alias-bg-base) 88%,transparent)}',
      '.dshSPS_demoPillDot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-state-business-primary);animation:dshSPS_pulse 1.8s ease-in-out infinite}',
      '.dshSPS_demoPillPhase{color:var(--dsw-alias-label-secondary);font-weight:500}',
      '.dshSPS_demoPillSep{color:var(--dsw-alias-separator-primary)}',
      '@keyframes dshSPS_in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}',
      '@keyframes dshSPS_breath{0%,100%{opacity:.95}50%{opacity:.78}}',
      '@keyframes dshSPS_pulse{0%,100%{opacity:1}50%{opacity:.45}}',
      '@media (prefers-reduced-motion:reduce){.dshSPS_demoLine.dshSPS_demoIn,.dshSPS_demoCaret,.dshSPS_demoPillDot{animation:none}}',
      '@media (max-width:560px){.dshSPS_master{flex-wrap:wrap;gap:10px}.dshSPS_grid{grid-template-columns:1fr}.dshSPS_previewHint{display:none}}',
      '@media (prefers-reduced-motion:reduce){.dshSPS_switch,.dshSPS_knob{transition:none}}',
    ].join('')

    /**
     * One titled group of settings cards.
     * @param {{ title: string, note?: string, children: object }} props - group copy.
     * @returns {object} the section element.
     */
    function SettingsSection(props) {
      return h('section', { className: 'dshSPS_section' },
        h('div', { className: 'dshSPS_sectionHead' },
          h('h4', { className: 'dshSPS_sectionTitle' }, props.title),
          props.note === undefined ? null : h('span', { className: 'dshSPS_sectionNote' }, props.note)),
        props.children)
    }

    /**
     * The master switch: full width above the grid, because it gates everything.
     * @param {{ title: string, hint: string, label: string, checked: boolean, onChange: Function }} props - switch state.
     * @returns {object} the row element.
     */
    function SettingsMaster(props) {
      return h('div', { className: 'dshSPS_master' },
        h('div', { className: 'dshSPS_masterText' },
          h('span', { className: 'dshSPS_masterTitle' }, props.title),
          h('span', { className: 'dshSPS_masterHint' }, props.hint)),
        h(SettingsSwitch, {
          checked: props.checked,
          label: props.label,
          onChange: props.onChange,
        }))
    }

    /**
     * One switch inside the card grid.
     * @param {{ title: string, hint: string, label: string, checked: boolean, disabled?: boolean, onChange: Function }} props - switch state.
     * @returns {object} the card element.
     */
    function SettingsToggleCard(props) {
      return h('div', {
        className: 'dshSPS_tile',
        'data-off': props.disabled === true ? 'true' : 'false',
      },
        h('div', { className: 'dshSPS_tileTop' },
          h('span', { className: 'dshSPS_tileTitle', title: props.title }, props.title),
          h(SettingsSwitch, {
            checked: props.checked,
            label: props.label,
            disabled: props.disabled,
            onChange: props.onChange,
          })),
        h('span', { className: 'dshSPS_tileHint' }, props.hint))
    }

    /**
     * One bounded integer inside the card grid.
     * @param {{ title: string, hint: string, option: string, value: number, t: Function, disabled?: boolean, onChange: Function }} props - field state.
     * @returns {object} the card element.
     */
    function SettingsNumberCard(props) {
      return h('div', {
        className: 'dshSPS_tile',
        'data-off': props.disabled === true ? 'true' : 'false',
      },
        h('span', { className: 'dshSPS_tileTitle', title: props.title }, props.title),
        h(SettingsNumber, {
          option: props.option,
          value: props.value,
          t: props.t,
          disabled: props.disabled,
          onChange: props.onChange,
        }),
        h('span', { className: 'dshSPS_tileHint' }, props.hint))
    }

    /**
     * One full-width line: a label column plus its control (used by the log level).
     * @param {{ title: string, hint: string, children: object }} props - copy and the control.
     * @returns {object} the line element.
     */
    function SettingsLine(props) {
      return h('div', { className: 'dshSPS_line' },
        h('div', { className: 'dshSPS_lineText' },
          h('span', { className: 'dshSPS_lineTitle' }, props.title),
          h('span', { className: 'dshSPS_lineHint' }, props.hint)),
        h('div', { className: 'dshSPS_lineControl' }, props.children))
    }

    /**
     * Accessible on/off switch.
     * @param {{ checked: boolean, label: string, disabled?: boolean, onChange: (next: boolean) => void }} props - switch state.
     * @returns {object} the switch element.
     */
    function SettingsSwitch(props) {
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': props.checked ? 'true' : 'false',
        'aria-label': props.label,
        className: 'dshSPS_switch',
        'data-on': props.checked ? 'true' : 'false',
        disabled: props.disabled === true ? true : undefined,
        onClick: () => props.onChange(!props.checked),
      }, h('span', { className: 'dshSPS_knob', 'aria-hidden': true }))
    }

    /**
     * One-choice segmented control.
     * @param {{ group: string, label: string, value: string, ids: readonly string[], t: Function, onChange: (id: string) => void }} props - control state.
     * @returns {object} the control element.
     */
    function SettingsSegments(props) {
      return h('div', { className: 'dshSPS_seg', role: 'group', 'aria-label': props.label },
        props.ids.map((id) => h('button', {
          key: id,
          type: 'button',
          className: 'dshSPS_segBtn',
          'data-active': props.value === id ? 'true' : undefined,
          'aria-pressed': props.value === id ? 'true' : 'false',
          onClick: () => props.onChange(id),
        }, props.labelFor(id))))
    }

    /**
     * Integer field with the option's own bounds; an out-of-range draft keeps
     * the input marked invalid and never reaches the store.
     * @param {{ option: string, value: number, t: Function, onChange: (next: number) => void }} props - field state.
     * @returns {object} the field element.
     */
    function SettingsNumber(props) {
      const rule = SPEC[props.option]
      const [draft, setDraft] = React.useState(String(props.value))
      React.useEffect(() => {
        setDraft(String(props.value))
      }, [props.value])
      const parsed = Number(draft)
      const valid = draft.trim() !== '' && Number.isInteger(parsed) && parsed >= rule.min && parsed <= rule.max
      return h('span', { className: 'dshSPS_num' },
        h('input', {
          className: 'dshSPS_input',
          type: 'number',
          inputMode: 'numeric',
          min: rule.min,
          max: rule.max,
          step: 1,
          value: draft,
          disabled: props.disabled === true ? true : undefined,
          'aria-label': props.t('settings.' + props.option),
          'aria-invalid': valid ? undefined : 'true',
          onChange: (event) => {
            const next = event.target.value
            setDraft(next)
            const number = Number(next)
            if (next.trim() !== '' && Number.isInteger(number) && number >= rule.min && number <= rule.max) {
              props.onChange(number)
            }
          },
          onBlur: () => {
            if (!valid) setDraft(String(props.value))
          },
        }),
        h('span', { className: 'dshSPS_unit' }, 'ms'))
    }

    /**
     * Fetch one function off the Host half's route table and return its JSON.
     * @param {string} path - path under `/api/stream-polish`.
     * @param {string} [method] - HTTP method.
     * @returns {Promise<object>} the parsed body, or an error envelope.
     */
    async function apiCall(path, method = 'GET') {
      if (typeof fetch !== 'function') {
        return { ok: false, error: 'no-fetch', message: 'fetch is unavailable in this browser' }
      }
      try {
        const response = await fetch('./api/stream-polish' + path, {
          method,
          headers: method === 'POST' ? { 'content-type': 'application/json' } : undefined,
          body: method === 'POST' ? '{}' : undefined,
          credentials: 'same-origin',
        })
        if (response.status === 404) {
          return { ok: false, error: 'no-route', message: 'Host half exposed no route for ' + path }
        }
        return await response.json()
      } catch (error) {
        return { ok: false, error: 'network', message: String(error) }
      }
    }

    /** The one-click Git upgrade card: version facts, check, upgrade. */
    function UpdatePanel({ t }) {
      const [phase, setPhase] = React.useState({
        busy: null,
        info: null,
        status: null,
        message: null,
        tone: null,
      })

      const patch = (next) => setPhase((current) => ({ ...current, ...next }))

      React.useEffect(() => {
        let alive = true
        void apiCall('/info').then((info) => {
          if (!alive) return
          patch(info.ok === true ? { info } : { message: info.message ?? t('update.failed'), tone: 'error' })
        })
        return () => {
          alive = false
        }
      }, [])

      const check = async () => {
        patch({ busy: 'check', message: null, tone: null })
        const status = await apiCall('/update')
        if (status.ok === false) {
          patch({ busy: null, status: null, message: status.message ?? t('update.failed'), tone: 'error' })
          return
        }
        patch({
          busy: null,
          status,
          tone: status.available ? null : 'ok',
          message: status.available
            ? t('update.available', { version: status.latestVersion ?? '?', n: status.behind })
            : t('update.uptodate', { version: status.version ?? '?' }),
        })
      }

      const upgrade = async () => {
        patch({ busy: 'apply', message: t('update.upgrading'), tone: 'busy' })
        const result = await apiCall('/update/apply', 'POST')
        if (result.ok === false) {
          patch({ busy: null, message: result.message ?? t('update.failed'), tone: 'error' })
          return
        }
        if (result.changed === false) {
          patch({ busy: null, message: result.message ?? t('update.uptodate', { version: result.version ?? '?' }), tone: 'ok' })
          return
        }
        const target = result.to ?? {}
        const next = result.reload === 'restart-required'
          ? t('update.restart')
          : t('update.upgraded', { version: target.version ?? '?', commit: target.shortCommit ?? '?' })
        patch({ busy: null, message: next, tone: result.reload === 'restart-required' ? 'error' : 'ok' })
        if (result.reload !== 'restart-required') {
          // The Host half recomposes itself ~0.6s after the response; give the
          // new client module a beat, then reload so both halves agree.
          window.setTimeout(() => {
            if (typeof window.location?.reload === 'function') window.location.reload()
          }, 1600)
        }
      }

      const info = phase.info
      const status = phase.status
      return h('div', { className: 'dshSPS_card' },
        h('div', { className: 'dshSPS_cardHead' },
          h('span', { className: 'dshSPS_cardTitle' }, t('update.title')),
          h('span', { className: 'dshSPS_cardNote' }, info === null
            ? t('settings.loading')
            : [t('settings.version', { version: info.version ?? '?' }), info.shortCommit === undefined ? null : t('settings.commit', { commit: info.shortCommit })].filter(Boolean).join(' · '))),
        h('div', { className: 'dshSPS_pair' },
          h('div', { className: 'dshSPS_pairItem' },
            h('span', { className: 'dshSPS_pairKey' }, t('update.current')),
            h('span', { className: 'dshSPS_pairValue' }, (status ?? info) === null
              ? '—'
              : ((status ?? info).commit ?? '').slice(0, 7) + ' · ' + ((status ?? info).version ?? '?'))),
          h('div', { className: 'dshSPS_pairItem' },
            h('span', { className: 'dshSPS_pairKey' }, t('update.latest')),
            h('span', { className: 'dshSPS_pairValue' }, status === null || status.ok === false
              ? '—'
              : (status.latestShortCommit ?? '—') + ' · ' + (status.latestVersion ?? '?')))),
        phase.message === null ? null : h('div', {
          className: 'dshSPS_status',
          'data-tone': phase.tone ?? undefined,
        }, phase.message),
        h('div', { className: 'dshSPS_foot' },
          h('button', {
            type: 'button',
            className: 'dshSPS_button',
            disabled: phase.busy !== null,
            onClick: () => void check(),
          }, phase.busy === 'check' ? t('update.checking') : t('update.check')),
          h('button', {
            type: 'button',
            className: 'dshSPS_button',
            'data-primary': 'true',
            disabled: phase.busy !== null || status === null || status.ok === false || status.available !== true,
            onClick: () => void upgrade(),
          }, phase.busy === 'apply' ? t('update.upgrading') : t('update.apply'))),
      )
    }

    /**
     * A miniature transcript that replays with the current settings.
     *
     * Every control writes the store, the page re-renders, and this snippet
     * shows the consequence immediately: the fade duration, the caret period,
     * whether the caret and the capsule exist at all, and which capsule
     * segments survive. Replaying bumps a key so React remounts the snippet and
     * the entry animation runs again.
     */
    function PreviewPanel(props) {
      const settings = props.settings
      const t = props.t
      const [cycle, setCycle] = React.useState(0)
      const stageStyle = {
        '--dshSPS-fade': settings.blockFadeMs + 'ms',
        '--dshSPS-period': settings.caretPeriodMs + 'ms',
      }
      const capsule = settings.runStrip
        ? h('div', { className: 'dshSPS_demoPill' },
          h('span', { className: 'dshSPS_demoPillDot' }),
          h('span', { className: 'dshSPS_demoPillPhase' }, t('preview.phase')),
          settings.showElapsed
            ? h('span', { className: 'dshSPS_demoPillSep', key: 'sep1' }, '·')
            : null,
          settings.showElapsed ? h('span', { key: 'elapsed' }, t('preview.elapsed')) : null,
          settings.showActivity
            ? h('span', { className: 'dshSPS_demoPillSep', key: 'sep2' }, '·')
            : null,
          settings.showActivity ? h('span', { key: 'activity' }, t('preview.activity')) : null)
        : h('div', { className: 'dshSPS_previewNote' }, t('preview.noCapsule'))

      return h('div', { className: 'dshSPS_preview' },
        h('div', { className: 'dshSPS_previewBar' },
          h('span', { className: 'dshSPS_previewTag' }, t('preview.title')),
          h('span', { className: 'dshSPS_previewHint' }, t('preview.hint')),
          h('button', {
            type: 'button',
            className: 'dshSPS_button',
            disabled: !settings.enabled,
            onClick: () => setCycle((value) => value + 1),
          }, t('preview.replay'))),
        settings.enabled
          ? h('div', { className: 'dshSPS_previewStage', key: cycle, style: stageStyle },
            h('p', { className: 'dshSPS_demoLine' }, t('preview.settled')),
            h('p', {
              className: 'dshSPS_demoLine dshSPS_demoIn',
              'data-fade': settings.blockFade ? 'true' : 'false',
            }, t('preview.fading', { ms: settings.blockFadeMs })),
            h('p', { className: 'dshSPS_demoLine' },
              t('preview.caret'),
              settings.caret ? h('span', { className: 'dshSPS_demoCaret', 'aria-hidden': true }) : null),
            capsule)
          : h('div', { className: 'dshSPS_previewEmpty' }, t('preview.off')))
    }

    /** The Stream polish page inside Settings -> Plugins. */
    function SettingsPage(props) {
      const settings = useSettings()
      const t = typeof props.t === 'function' ? props.t : translate
      const update = (patch) => store.update(patch)
      const toggle = (key) => h(SettingsSwitch, {
        checked: settings[key],
        label: t('settings.' + key),
        onChange: (next) => update({ [key]: next }),
      })
      const number = (key) => h(SettingsNumber, {
        option: key,
        value: settings[key],
        t,
        onChange: (next) => update({ [key]: next }),
      })

      try {
        return renderPage()
      } catch (error) {
        // A crash here would blank the slot entry with only a console line, so
        // show the failure in place instead.
        return h('div', { className: 'dshSPS_page' },
          h('p', { className: 'dshSPS_status', 'data-tone': 'error' },
            'settings page failed: ' + (error instanceof Error ? error.message : String(error))))
      }

      function renderPage() {
        const caretOff = !settings.caret
        const stripOff = !settings.runStrip
        const toggle = (key, disabled) => h(SettingsToggleCard, {
          key,
          title: t('settings.' + key),
          hint: t('settings.' + key + 'Hint'),
          label: t('settings.' + key),
          checked: settings[key],
          disabled,
          onChange: (next) => update({ [key]: next }),
        })
        const field = (key, disabled) => h(SettingsNumberCard, {
          key,
          title: t('settings.' + key),
          hint: t('settings.range', { min: SPEC[key].min, max: SPEC[key].max }),
          option: key,
          value: settings[key],
          t,
          disabled,
          onChange: (next) => update({ [key]: next }),
        })

        return h('div', { className: 'dshSPS_page' },
          h('div', { className: 'dshSPS_head' },
            h('h3', { className: 'dshSPS_title' }, t('settings.title')),
            h('p', { className: 'dshSPS_intro' }, t('settings.intro')),
            h('div', { className: 'dshSPS_meta' },
              store.isDefault() ? null : h('span', { className: 'dshSPS_badge' }, t('settings.badgeLocal')))),

          h(PreviewPanel, { settings, t }),

          h(UpdatePanel, { t }),

          h(SettingsSection, { title: t('settings.display'), note: t('settings.displayNote') },
            h(SettingsMaster, {
              title: t('settings.enabled'),
              hint: t('settings.enabledHint'),
              label: t('settings.enabled'),
              checked: settings.enabled,
              onChange: (next) => update({ enabled: next }),
            }),
            h('div', { className: 'dshSPS_grid' },
              toggle('blockFade', !settings.enabled),
              toggle('caret', !settings.enabled),
              toggle('settleFade', !settings.enabled || caretOff),
              toggle('runStrip', !settings.enabled),
              toggle('showElapsed', !settings.enabled || stripOff),
              toggle('showActivity', !settings.enabled || stripOff))),

          h(SettingsSection, { title: t('settings.timing'), note: t('settings.timingNote') },
            h('div', { className: 'dshSPS_grid' },
              field('blockFadeMs', !settings.enabled || !settings.blockFade),
              field('caretPeriodMs', !settings.enabled || caretOff),
              field('settleMs', !settings.enabled || caretOff || !settings.settleFade),
              field('stallMs', !settings.enabled))),

          h(SettingsSection, { title: t('settings.log') },
            h(SettingsLine, {
              title: t('settings.logLevel'),
              hint: t('settings.logLevelHint'),
            },
              h(SettingsSegments, {
                group: 'logLevel',
                label: t('settings.logLevel'),
                ids: LOG_LEVELS,
                value: settings.logLevel,
                t,
                labelFor: (id) => id,
                onChange: (next) => update({ logLevel: next }),
              }))),

          h('div', { className: 'dshSPS_foot' },
            h('button', {
              type: 'button',
              className: 'dshSPS_button',
              disabled: store.isDefault(),
              onClick: () => store.reset(),
            }, t('settings.reset')),
            h('span', { className: 'dshSPS_footHint' }, t('settings.footHint'))))
      }
    }

    /**
     * Mount the decoration stylesheet and the observers it needs.
     * @param {Record<string, unknown>} s - settings snapshot.
     * @returns {{ dispose: () => void }} the teardown.
     */
    function mountSurfaces(s) {
      const style = document.createElement('style')
      style.dataset.plugin = '@local/stream-polish'
      style.textContent = buildCss(s)
      document.head.appendChild(style)

      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
      /** @type {Map<HTMLElement, number>} */
      const timers = new Map()

      /** Forget a pending cleanup and drop any in-flight settle state. */
      const begin = (root) => {
        const timer = timers.get(root)
        if (timer !== undefined) {
          window.clearTimeout(timer)
          timers.delete(root)
        }
        root.removeAttribute(SETTLE_ATTR)
      }

      const cleanupMs = s.settleMs + 80

      /** Keep the caret mounted long enough to fade after the reply settles. */
      const settle = (root) => {
        if (reducedMotion.matches) return
        if (root.querySelector(CARET_TARGET) === null) return
        begin(root)
        root.setAttribute(SETTLE_ATTR, '')
        timers.set(root, window.setTimeout(() => {
          timers.delete(root)
          root.removeAttribute(SETTLE_ATTR)
        }, cleanupMs))
      }

      let settleObserver = null
      if (s.caret && s.settleFade) {
        settleObserver = new MutationObserver((records) => {
          for (const record of records) {
            if (record.attributeName !== 'data-streaming') continue
            const root = record.target
            if (!(root instanceof HTMLElement)) continue
            if (root.hasAttribute('data-streaming')) begin(root)
            else settle(root)
          }
        })
        settleObserver.observe(document.documentElement, {
          subtree: true,
          attributes: true,
          attributeFilter: ['data-streaming'],
        })
      }

      let runObserver = null
      if (s.runStrip) {
        runObserver = new MutationObserver((records) => {
          let phaseDirty = false
          for (const record of records) {
            const target = record.target
            const el = target.nodeType === 1 ? target : target.parentElement
            if (el === null || el === undefined) continue
            if (el.closest('[data-chat-flow]') === null) continue
            if (el.closest('[data-chat-running]') !== null) continue
            if (el.closest('[data-shimmer]') !== null) continue
            if (record.type === 'characterData') {
              const text = (target.data ?? '').trim()
              if (/^\d+(?:\.\d+)?[smh]?(?:\s+\d+(?:\.\d+)?[smh]?)*$/.test(text)) continue
              if (el.closest('[data-streaming],[data-tool]') !== null) runStore.touch()
            } else if (record.type === 'childList') {
              runStore.touch()
              phaseDirty = true
            } else if (record.type === 'attributes') {
              runStore.touch()
              phaseDirty = true
            }
          }
          if (phaseDirty) runStore.syncPhase()
        })
        runObserver.observe(document.documentElement, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
          attributeFilter: ['data-state', 'data-streaming'],
        })
      }

      return {
        dispose() {
          if (settleObserver !== null) settleObserver.disconnect()
          if (runObserver !== null) runObserver.disconnect()
          runStore.stop()
          for (const timer of timers.values()) window.clearTimeout(timer)
          timers.clear()
          for (const root of document.querySelectorAll('[' + SETTLE_ATTR + ']')) {
            root.removeAttribute(SETTLE_ATTR)
          }
          style.remove()
        },
      }
    }

    /**
     * Mount every contribution for as long as this plugin runs.
     * @param ctx - Client context owning the contributions.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'stream-polish: dictionaries')

      const bound = typeof ctx.locale.bind === 'function' ? ctx.locale.bind(NS) : (key) => key
      translate = bound

      // The settings page must survive `enabled: false` — that is how a user
      // turns the decoration back on — so its stylesheet is mounted separately
      // from the decoration's.
      ctx.effect(() => {
        const element = document.createElement('style')
        element.dataset.pluginPage = '@local/stream-polish'
        element.textContent = PAGE_CSS
        document.head.appendChild(element)
        return () => element.remove()
      }, 'stream-polish: settings styles')

      ctx.effect(() => {
        let surface = null
        const sync = () => {
          if (surface !== null) {
            surface.dispose()
            surface = null
          }
          const current = store.get()
          logAt('debug', 'debug', 'applying settings ' + JSON.stringify(current))
          if (current.enabled) surface = mountSurfaces(current)
        }
        sync()
        const unsubscribe = store.subscribe(sync)
        return () => {
          unsubscribe()
          if (surface !== null) surface.dispose()
          surface = null
        }
      }, 'stream-polish: surfaces')

      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'run-strip',
        order: 0,
        locale: NS,
      }, RunStrip))

      // The bundle's own page inside Settings -> Plugins: this is where the
      // Plugins page renders a package's configuration, keyed by its package
      // name. `view: 'summary'` asks for a one-liner only; the page itself is
      // rendered for `view: 'page'`.
      ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config',
        key: PACKAGE,
        locale: NS,
      }, (ownerProps) => {
        if (ownerProps !== undefined && ownerProps.view === 'summary') return null
        return h(SettingsPage, ownerProps ?? {})
      }))
    }

    return { inject: ['slots', 'locale'], apply, name: 'stream-polish' }
  },
})
