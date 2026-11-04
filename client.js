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

    /** Caret fade duration; keep in sync with `dshSP_caretOut` below. */
    const FADE_MS = 260

    /** A little longer than the fade, so the class never outlives the motion. */
    const CLEANUP_MS = 340

    /** No new output for this long is reported as a wait, not activity. */
    const STALL_MS = (() => {
      const override = Number(globalThis.__DSH_SP_STALL_MS__)
      return Number.isFinite(override) && override > 0 ? override : 15000
    })()

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
      const stalled = idle >= STALL_MS
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

      return h('div', { className: 'dshRS_root', 'data-dsh-run-strip': '' },
        h('span', {
          className: 'dshRS_pill',
          'data-stalled': stalled ? '' : undefined,
          role: 'status',
          'aria-live': 'off',
          'aria-label': t('aria', { phase, elapsed, activity }),
        },
          h('span', { className: 'dshRS_dot' }),
          h('span', { className: 'dshRS_phase' }, phase),
          h('span', { className: 'dshRS_sep' }, '·'),
          h('span', { className: 'dshRS_time' }, elapsed),
          h('span', { className: 'dshRS_sep' }, '·'),
          h('span', { className: 'dshRS_activity' }, activity),
        ),
      )
    }

    /** Styles owned by this plugin. */
    const CSS = [
      '@keyframes dshSP_blockIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}',
      '@keyframes dshSP_caret{0%,100%{opacity:.95}50%{opacity:.78}}',
      '@keyframes dshSP_caretOut{from{opacity:.95}to{opacity:0}}',

      // New markdown blocks fade in as they mount. Settled blocks keep their
      // identity, so they never replay the animation on later tokens.
      '[data-streaming] > div > div > :is(p,h1,h2,h3,h4,h5,h6,pre,blockquote,table,.md-code-block,.md-table-wide),',
      '[data-streaming] > div > div > :is(ul,ol) > li{animation:dshSP_blockIn .16s cubic-bezier(.2,.7,.3,1)}',

      // Breathing caret after the block currently being written. A negative
      // right margin cancels the caret's own advance, so the last line does
      // not reflow when the reply settles and the caret disappears.
      ':is([data-streaming],[' + SETTLE_ATTR + ']) > div > div:last-child > :is(p,h1,h2,h3,h4,h5,h6):last-child::after,',
      ':is([data-streaming],[' + SETTLE_ATTR + ']) > div > div:last-child > :is(ul,ol):last-child > li:last-child::after,',
      ':is([data-streaming],[' + SETTLE_ATTR + ']) > div > div:last-child > blockquote:last-child > p:last-child::after{',
      'content:"";display:inline-block;width:2px;height:1.05em;margin:0 -5px 0 3px;',
      'vertical-align:-.16em;border-radius:1px;pointer-events:none;',
      'background:currentColor;',
      'background:linear-gradient(180deg,currentColor 15%,color-mix(in srgb,currentColor 30%,transparent));',
      'animation:dshSP_caret 1.2s ease-in-out infinite}',

      // Settling: stop the breath and run one short opacity fade instead.
      '[' + SETTLE_ATTR + '] > div > div:last-child > :is(p,h1,h2,h3,h4,h5,h6):last-child::after,',
      '[' + SETTLE_ATTR + '] > div > div:last-child > :is(ul,ol):last-child > li:last-child::after,',
      '[' + SETTLE_ATTR + '] > div > div:last-child > blockquote:last-child > p:last-child::after{',
      'animation:dshSP_caretOut .26s ease-out forwards}',

      '@media (prefers-reduced-motion:reduce){',
      '[data-streaming] > div > div > :is(p,h1,h2,h3,h4,h5,h6,pre,blockquote,table,.md-code-block,.md-table-wide),',
      '[data-streaming] > div > div > :is(ul,ol) > li{animation:none}',
      ':is([data-streaming],[' + SETTLE_ATTR + ']) > div > div:last-child > :is(p,h1,h2,h3,h4,h5,h6):last-child::after,',
      ':is([data-streaming],[' + SETTLE_ATTR + ']) > div > div:last-child > :is(ul,ol):last-child > li:last-child::after,',
      ':is([data-streaming],[' + SETTLE_ATTR + ']) > div > div:last-child > blockquote:last-child > p:last-child::after{',
      'animation:none;opacity:.65}}',

      '@media (forced-colors:active){',
      ':is([data-streaming],[' + SETTLE_ATTR + ']) > div > div:last-child > :is(p,h1,h2,h3,h4,h5,h6):last-child::after,',
      ':is([data-streaming],[' + SETTLE_ATTR + ']) > div > div:last-child > :is(ul,ol):last-child > li:last-child::after,',
      ':is([data-streaming],[' + SETTLE_ATTR + ']) > div > div:last-child > blockquote:last-child > p:last-child::after{',
      'background:CanvasText;forced-color-adjust:none}}',

      // Run capsule: absolutely positioned above the resident composer, so it
      // never changes the composer height or pushes the transcript.
      '@keyframes dshRS_pulse{0%,100%{opacity:1}50%{opacity:.45}}',
      '.dshRS_root{position:absolute;left:0;right:0;bottom:calc(100% + 8px);z-index:6;display:flex;justify-content:center;pointer-events:none}',
      '.dshRS_pill{box-sizing:border-box;display:inline-flex;align-items:center;gap:7px;max-width:calc(100% - 32px);height:26px;padding:0 11px;',
      'border:1px solid var(--dsw-alias-border-l2);border-radius:999px;white-space:nowrap;font-variant-numeric:tabular-nums;',
      'color:var(--dsw-alias-label-tertiary);font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);',
      'line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));',
      'background:color-mix(in srgb,var(--dsw-alias-bg-base) 88%,transparent);',
      'box-shadow:0 4px 18px color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);',
      'backdrop-filter:blur(10px)}',
      '.dshRS_dot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-state-business-primary);animation:dshRS_pulse 1.8s ease-in-out infinite}',
      '.dshRS_phase{color:var(--dsw-alias-label-secondary);font-weight:500;overflow:hidden;text-overflow:ellipsis}',
      '.dshRS_sep{color:var(--dsw-alias-separator-primary)}',
      '.dshRS_activity{min-width:0;overflow:hidden;text-overflow:ellipsis}',
      '.dshRS_pill[data-stalled] .dshRS_dot{background:var(--dsw-alias-state-warn-primary);animation:none}',
      '.dshRS_pill[data-stalled] .dshRS_activity{color:var(--dsw-alias-state-warn-primary)}',
      '@media (prefers-reduced-motion:reduce){.dshRS_dot{animation:none}}',
      '@media (forced-colors:active){.dshRS_pill{border-color:CanvasText;background:Canvas;color:CanvasText}.dshRS_dot{background:Highlight}}',
    ].join('')

    /**
     * Mount the stylesheet, the settle observer, the run observer, and the
     * composer capsule for as long as this plugin runs.
     * @param ctx - Client context owning the contribution.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'stream-polish: dictionaries')

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
          }, CLEANUP_MS))
        }

        const settleObserver = new MutationObserver((records) => {
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

        const runObserver = new MutationObserver((records) => {
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

        return () => {
          settleObserver.disconnect()
          runObserver.disconnect()
          runStore.stop()
          for (const timer of timers.values()) window.clearTimeout(timer)
          timers.clear()
          for (const root of document.querySelectorAll('[' + SETTLE_ATTR + ']')) {
            root.removeAttribute(SETTLE_ATTR)
          }
          style.remove()
        }
      }, 'stream-polish: styles and observers')

      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'run-strip',
        order: 0,
        locale: NS,
      }, RunStrip))
    }

    return { inject: ['slots', 'locale'], apply, name: 'stream-polish' }
  },
})
