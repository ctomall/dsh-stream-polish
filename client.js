/**
 * Stream polish, Client half.
 *
 * Two presentation-only surfaces:
 *  - a soft fade for markdown blocks while an Assistant reply streams, plus a
 *    breathing caret that fades out when the reply settles;
 *  - a compact run capsule above the composer that names the current phase,
 *    counts elapsed time, and calls out stretches with no new output.
 *
 * It touches no renderer state, no Session data, and no host code. Selectors
 * use the stable attributes the Chat publishes (`data-streaming`, `data-tool`,
 * `data-state`, `data-chat-flow`, `data-chat-running`), never hashed CSS-module
 * class names.
 *
 * Everything visible is resolved from one settings object at module load:
 * defaults -> row config published by the Host half (or the patch row applied
 * directly) -> this browser's saved overrides -> the `__DSH_SP_STALL_MS__`
 * test hook. A page reload re-resolves, so changing configuration never needs
 * a source edit.
 */
window.__ModuleLoader__.load({
  id: '@local/stream-polish',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace owned by the run capsule. */
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
     * Resolve the effective settings from every source, in precedence order.
     * @returns {{ settings: Record<string, unknown>, issues: Array<{ key: string, message: string }> }} the resolved state.
     */
    function resolveSettings() {
      const settings = {}
      for (const key of KEYS) settings[key] = DEFAULTS[key]
      const issues = []
      accept(settings, readWire(), issues, 'host')
      accept(settings, readSaved(), issues, 'saved')

      // Test hook kept from the previous release: it still wins over everything
      // and is deliberately not range-checked, because a harness needs a stall
      // that arrives in under a second.
      const hook = Number(globalThis.__DSH_SP_STALL_MS__)
      if (Number.isFinite(hook) && hook > 0) settings.stallMs = Math.round(hook)

      if (!LOG_LEVELS.includes(settings.logLevel)) settings.logLevel = DEFAULTS.logLevel
      return { settings, issues }
    }

    const resolved = resolveSettings()
    const settings = resolved.settings

    /** Write one diagnostic line, unless `logLevel` is quieter than `level`. */
    function logAt(level, method, text) {
      const rank = LEVEL_RANK[settings.logLevel] ?? LEVEL_RANK.warn
      if (rank < LEVEL_RANK[level]) return
      const sink = typeof console[method] === 'function' ? console[method] : console.log
      sink.call(console, PREFIX + text)
    }

    for (const issue of resolved.issues) logAt('warn', 'warn', issue.message)
    logAt('info', 'info', 'configuration resolved'
      + (resolved.issues.length === 0 ? '' : ' with ' + resolved.issues.length + ' issue(s)'))
    logAt('debug', 'debug', 'resolved config ' + JSON.stringify(settings))

    /**
     * Debug surface: the resolved state plus the table it was validated
     * against. Tests read this to prove the mirror matches `config.js`.
     */
    globalThis.__DSH_STREAM_POLISH_CLIENT__ = {
      version: WIRE_VERSION,
      settings,
      issues: resolved.issues,
      defaults: DEFAULTS,
      spec: SPEC,
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
      const [, setVersion] = React.useState(0)

      React.useEffect(() => runStore.subscribe(() => setVersion((value) => value + 1)), [])

      React.useEffect(() => {
        if (session !== undefined) runStore.setRunning(session.running, session.sessionId)
      }, [session?.running, session?.sessionId])

      React.useEffect(() => () => runStore.stop(), [])

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
     * Build the stylesheet for one settings snapshot.
     *
     * A disabled feature contributes no rule at all, so the browser never even
     * parses the animation it was told to skip. Durations come straight from
     * the resolved config.
     * @param {Record<string, unknown>} s - resolved settings.
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

    /** Stylesheet for the resolved settings. */
    const CSS = buildCss(settings)

    /**
     * Mount the stylesheet, the settle observer, the run observer, and the
     * composer capsule for as long as this plugin runs.
     * @param ctx - Client context owning the contribution.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'stream-polish: dictionaries')

      // `enabled: false` keeps the row loaded and public (so a patch edit or a
      // localStorage override can turn it back on after a reload) but mounts
      // nothing at all.
      if (!settings.enabled) {
        logAt('info', 'info', 'disabled by configuration; no surface mounted')
        return
      }

      const settleEnabled = settings.caret && settings.settleFade
      const cleanupMs = settings.settleMs + 80

      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.plugin = '@local/stream-polish'
        style.textContent = CSS
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
        if (settleEnabled) {
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
        if (settings.runStrip) {
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

        return () => {
          if (settleObserver !== null) settleObserver.disconnect()
          if (runObserver !== null) runObserver.disconnect()
          runStore.stop()
          for (const timer of timers.values()) window.clearTimeout(timer)
          timers.clear()
          for (const root of document.querySelectorAll('[' + SETTLE_ATTR + ']')) {
            root.removeAttribute(SETTLE_ATTR)
          }
          style.remove()
        }
      }, 'stream-polish: styles and observers')

      if (settings.runStrip) {
        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock',
          id: 'run-strip',
          order: 0,
          locale: NS,
        }, RunStrip))
      }
    }

    return { inject: ['slots', 'locale'], apply, name: 'stream-polish' }
  },
})
