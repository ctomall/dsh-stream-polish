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
    const WIRE_VERSION = 3

    /** Target-language tags accepted by the reasoning translator; mirrors `config.js`. */
    const LANGUAGE_PATTERN = /^(?:auto|[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*)$/

    /** Six-digit hex colours accepted by the step panel accent option; mirrors `config.js`. */
    const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

    /** Translation services the Host route accepts; mirrors `config.js`. */
    const TRANSLATION_PROVIDERS = ['bing', 'google']

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
      stepPanel: { type: 'boolean', default: true },
      stepPanelRows: { type: 'integer', default: 5, min: 1, max: 20 },
      stepPanelAccent: { type: 'string', default: '#4f8cff', pattern: COLOR_PATTERN },
      stepPanelMotion: { type: 'boolean', default: true },
      stepPanelPhaseColors: { type: 'boolean', default: true },
      replaceToolRows: { type: 'boolean', default: false },
      toolCardPolish: { type: 'boolean', default: true },
      translation: { type: 'boolean', default: false },
      translationProvider: { type: 'enum', default: 'bing', values: TRANSLATION_PROVIDERS },
      translationTargetLanguage: { type: 'string', default: 'zh-CN', pattern: LANGUAGE_PATTERN },
      translationTimeoutMs: { type: 'integer', default: 8000, min: 1000, max: 30000 },
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
      if (rule.type === 'string') return 'a string matching ' + String(rule.pattern)
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
      if (rule.type === 'string') return typeof value === 'string' && rule.pattern.test(value)
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
     * Read the Host's optional-capability snapshot from the same wire payload.
     *
     * A Host without the optional `translator` service still publishes the row;
     * `translation.available` is then false and the reasoning body keeps the
     * original text. A missing or foreign payload fails closed.
     * @returns {{ translation: { available: boolean, maxTextChars: number | null } }} capability facts.
     */
    function readCapabilities() {
      const fallback = { translation: { available: false, maxTextChars: null } }
      try {
        const wire = globalThis[GLOBAL_NAME]
        if (wire === null || typeof wire !== 'object' || wire.version !== WIRE_VERSION) return fallback
        const capabilities = wire.capabilities
        if (capabilities === null || typeof capabilities !== 'object') return fallback
        const translation = capabilities.translation
        if (translation === null || typeof translation !== 'object') return fallback
        return {
          translation: {
            available: translation.available === true,
            maxTextChars: Number.isInteger(translation.maxTextChars) && translation.maxTextChars > 0
              ? translation.maxTextChars
              : null,
          },
        }
      } catch {
        return fallback
      }
    }

    /**
     * Read the wire version this page was served with.
     *
     * A page served by an older Host half keeps working from the Client's own
     * defaults, but translation routes and capability facts only exist in v3;
     * the settings page uses this to explain why the switch would be inert.
     * @returns {number | null} the served version, when recognizable.
     */
    function readWireVersion() {
      try {
        const wire = globalThis[GLOBAL_NAME]
        return wire !== null && typeof wire === 'object' && Number.isInteger(wire.version)
          ? wire.version
          : null
      } catch {
        return null
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

    /** Active UI locale id, kept current by `apply` for `auto` target languages. */
    let uiLocale = 'en'

    /**
     * Resolve the configured target language at request time.
     *
     * `auto` follows the interface language, matching the official
     * translator consumer; a concrete tag passes through unchanged.
     * @param {unknown} value - configured `translationTargetLanguage`.
     * @returns {string} a provider-ready language tag.
     */
    function resolveTargetLanguage(value) {
      if (value !== 'auto') return typeof value === 'string' && value !== '' ? value : 'zh-CN'
      return uiLocale === 'zh' ? 'zh-CN' : (uiLocale === '' ? 'en' : uiLocale)
    }

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
      /** Pure projections the self-tests drive without a DOM. */
      buildSteps,
      stablePrefix,
      rowDuration,
      presetPatch,
      presetActive,
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
      'settings.steps': '步骤面板',
      'settings.stepsNote': '输入框上方逐条显示本轮动作、对象、状态与用时',
      'settings.stepPanel': '显示步骤面板',
      'settings.stepPanelHint': '关闭后不挂载步骤列表，运行胶囊不受影响',
      'settings.stepPanelRows': '可见步骤数',
      'settings.stepPanelRowsHint': '更早的步骤折叠成一行计数',
      'settings.stepPanelAccent': '强调色',
      'settings.stepPanelAccentHint': '六位十六进制，例如 #4f8cff',
      'settings.stepPanelMotion': '步骤动效',
      'settings.stepPanelMotionHint': '新增步骤淡入并轻微上移；系统要求减少动态效果时自动关闭',
      'settings.stepPanelPhaseColors': '阶段着色',
      'settings.stepPanelPhaseColorsHint': '思考中性、工具强调、失败红、完成绿',
      'settings.toolCardPolish': '工具卡美化',
      'settings.toolCardPolishHint': '给原生工具行加圆角、描边、悬停和运行/失败状态色；只改绘制，不改宽高与点击区',
      'settings.replaceToolRows': '替换工具行',
      'settings.replaceToolRowsHint': '开启且面板可见时隐藏正文里的原生工具行；关闭即恢复。工具结果、diff 和命令输出将不再显示在原位。',
      'settings.translation': '思考翻译',
      'settings.translationNote': '把展开的思考内容机器翻译为下方语言',
      'settings.translationEnabled': '启用思考翻译',
      'settings.translationEnabledHint': '展开思考后才发送；关闭、切换语言或卸载插件会取消未完成请求',
      'settings.translationProvider': '翻译服务',
      'settings.translationProviderHint': 'Bing 与 Google 都是匿名端点，可能限流或不可用',
      'settings.translationTargetLanguage': '目标语言',
      'settings.translationTargetLanguageHint': 'auto 跟随界面语言；也可填写 zh-CN、en、ja 等标签',
      'settings.translationTimeoutMs': '翻译超时',
      'settings.translationPrivacy': '展开的思考内容会发送给所选翻译服务，可能包含私有代码或对话细节；原文始终保留在同一位置。',
      'settings.translationUnavailable': '本部署没有挂载 translator 服务，翻译开关不会生效。',
      'settings.translationStaleHost': 'Host 半仍是旧版本（未重启/未重载），翻译路由与能力尚未下发；重启 dsh 或停用再启用本插件后生效。',
      'step.title': '本轮步骤',
      'step.earlier': '更早 {n} 条',
      'step.empty': '本轮还没有步骤',
      'step.thinking': '思考',
      'step.reply': '回复',
      'step.status.running': '进行中',
      'step.status.done': '完成',
      'step.status.error': '失败',
      'step.status.pending': '准备中',
      'step.tool.bash': '运行命令',
      'step.tool.read': '读取文件',
      'step.tool.write': '写入文件',
      'step.tool.edit': '编辑文件',
      'step.tool.grep': '搜索代码',
      'step.tool.glob': '查找文件',
      'step.tool.websearch': '搜索网页',
      'step.tool.webfetch': '访问网页',
      'step.tool.subagent': '子智能体',
      'translate.viewOriginal': '查看原文',
      'translate.viewTranslation': '查看译文',
      'translate.translating': '正在翻译思考内容',
      'translate.failed': '翻译暂不可用，已显示原文',
      'translate.unavailable': '翻译服务不可用',
      'translate.retry': '重试',
      'translate.tail': '待译片段保留原文',
      'copy': '复制',
      'copied': '已复制',
      'codeTitle': '代码块',
      'wrap': '自动换行',
      'unwrap': '不换行',
      'footnotes': '脚注',
      'settings.logLevel': '日志级别',
      'settings.logLevelHint': '合法配置下默认完全静默',
      'settings.reset': '恢复默认',
      'settings.resetHint': '清除本浏览器的覆盖值',
      'settings.footHint': '改动立即生效；要成为所有浏览器的默认值，请改档案里的 cordis.patch.yml。',
      'settings.presets': '快速预设',
      'settings.preset.calm': '克制',
      'settings.preset.standard': '标准',
      'settings.preset.full': '全开',
      'settings.presetHint': '只改外观与面板，不会自动开启翻译',
      'settings.resetGroup': '恢复本组',
      'settings.resetGroupHint': '把本组恢复为档案默认值',
      'settings.translationTest': '测试翻译',
      'settings.translationTesting': '翻译中…',
      'settings.translationTestHint': '用一句英文样例验证当前服务与目标语言',
      'settings.translationTestOk': '译文：{text}',
      'settings.translationTestFail': '测试失败：{code}',
      'preview.live': '实时预览',
      'preview.play': '播放',
      'preview.pause': '暂停',
      'preview.noPanel': '步骤面板已关闭',
      'preview.noTool': '工具卡美化已关闭',
      'preview.replaced': '工具行已由步骤面板替换',
      'preview.thinkingSample': '检查配置与渲染路径',
      'preview.replySample': '已更新插件详情页',
      'preview.translationSample': '思考内容的中文译文',
      'preview.translationToolbar': '查看原文',
      'preview.stepHeader': '本轮步骤',
      'preview.earlier': '更早 {n} 条',
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
      'settings.steps': 'Step panel',
      'settings.stepsNote': 'One line per this-turn action, object, state, and duration above the composer',
      'settings.stepPanel': 'Show step panel',
      'settings.stepPanelHint': 'Off unmounts the step list; the run capsule is unaffected',
      'settings.stepPanelRows': 'Visible steps',
      'settings.stepPanelRowsHint': 'Earlier steps fold into one counted line',
      'settings.stepPanelAccent': 'Accent colour',
      'settings.stepPanelAccentHint': 'Six-digit hex, for example #4f8cff',
      'settings.stepPanelMotion': 'Step motion',
      'settings.stepPanelMotionHint': 'New steps fade and lift in; reduced-motion turns this off',
      'settings.stepPanelPhaseColors': 'Phase colours',
      'settings.stepPanelPhaseColorsHint': 'Neutral thinking, accent tools, red failures, green completion',
      'settings.toolCardPolish': 'Tool card polish',
      'settings.toolCardPolishHint': 'Rounded surface, hairline, hover, and running/failed state tint for native tool rows; paint only, no layout change',
      'settings.replaceToolRows': 'Replace tool rows',
      'settings.replaceToolRowsHint': 'While the panel is visible, hide native transcript tool rows; turning it off restores them. Tool results, diffs, and command output stop rendering in place.',
      'settings.translation': 'Reasoning translation',
      'settings.translationNote': 'Machine-translate expanded reasoning into the language below',
      'settings.translationEnabled': 'Enable reasoning translation',
      'settings.translationEnabledHint': 'Sends only after expansion; closing, changing language, or unloading cancels pending requests',
      'settings.translationProvider': 'Translation service',
      'settings.translationProviderHint': 'Bing and Google are anonymous endpoints and may rate-limit or fail',
      'settings.translationTargetLanguage': 'Target language',
      'settings.translationTargetLanguageHint': 'auto follows the UI language; zh-CN, en, ja and other tags also work',
      'settings.translationTimeoutMs': 'Translation timeout',
      'settings.translationPrivacy': 'Expanded reasoning is sent to the selected service and may contain private code or conversation details; the original stays in place.',
      'settings.translationUnavailable': 'This deployment mounted no translator service, so the switch has no effect.',
      'settings.translationStaleHost': 'The Host half is still the old build (not restarted/reloaded), so translation routes and capabilities are missing; restart dsh or toggle this plugin off and on.',
      'step.title': 'This turn',
      'step.earlier': '{n} earlier',
      'step.empty': 'No steps in this turn yet',
      'step.thinking': 'Thinking',
      'step.reply': 'Reply',
      'step.status.running': 'running',
      'step.status.done': 'done',
      'step.status.error': 'failed',
      'step.status.pending': 'preparing',
      'step.tool.bash': 'Run command',
      'step.tool.read': 'Read file',
      'step.tool.write': 'Write file',
      'step.tool.edit': 'Edit file',
      'step.tool.grep': 'Search code',
      'step.tool.glob': 'Find files',
      'step.tool.websearch': 'Search web',
      'step.tool.webfetch': 'Open page',
      'step.tool.subagent': 'Subagent',
      'translate.viewOriginal': 'View original',
      'translate.viewTranslation': 'View translation',
      'translate.translating': 'Translating reasoning',
      'translate.failed': 'Translation unavailable; showing the original',
      'translate.unavailable': 'Translation service unavailable',
      'translate.retry': 'Retry',
      'translate.tail': 'The unfinished tail keeps the original',
      'copy': 'Copy',
      'copied': 'Copied',
      'codeTitle': 'Code block',
      'wrap': 'Wrap lines',
      'unwrap': 'Unwrap lines',
      'footnotes': 'Footnotes',
      'settings.logLevel': 'Log level',
      'settings.logLevelHint': 'A valid config stays silent at the default level',
      'settings.reset': 'Reset',
      'settings.resetHint': 'Clear this browser\u2019s overrides',
      'settings.footHint': 'Changes apply immediately; edit the profile cordis.patch.yml to change the defaults for every browser.',
      'settings.presets': 'Presets',
      'settings.preset.calm': 'Calm',
      'settings.preset.standard': 'Standard',
      'settings.preset.full': 'Full',
      'settings.presetHint': 'Visuals and panel only; never turns translation on',
      'settings.resetGroup': 'Reset group',
      'settings.resetGroupHint': 'Restore this group to the profile defaults',
      'settings.translationTest': 'Test translation',
      'settings.translationTesting': 'Translating…',
      'settings.translationTestHint': 'Checks the selected service and target language with one English sentence',
      'settings.translationTestOk': 'Translation: {text}',
      'settings.translationTestFail': 'Test failed: {code}',
      'preview.live': 'Live preview',
      'preview.play': 'Play',
      'preview.pause': 'Pause',
      'preview.noPanel': 'Step panel is off',
      'preview.noTool': 'Tool card polish is off',
      'preview.replaced': 'Tool rows are replaced by the step panel',
      'preview.thinkingSample': 'Checking the configuration and render path',
      'preview.replySample': 'Updated the plugin detail page',
      'preview.translationSample': 'Chinese translation of the reasoning',
      'preview.translationToolbar': 'View original',
      'preview.stepHeader': 'This turn',
      'preview.earlier': '{n} earlier',
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

      if (s.toolCardPolish) {
        // Tool-card redesign using the same visual language as the step panel:
        // a rounded surface, a state stripe, and a hairline drawn with
        // box-shadow so width and hit area never move. Nested subcalls stay
        // flat so one deep tree does not become cards inside cards.
        const tool = ':where([data-chat-flow] [data-tool])'
        const nested = ':where([data-chat-flow] [data-tool] [data-tool])'
        parts.push(tool + '{position:relative;box-sizing:border-box;margin:3px 0;padding:5px 10px 5px 12px;'
          + 'border-radius:12px;'
          + 'background:linear-gradient(180deg,'
          + 'color-mix(in srgb,var(--dsw-alias-bg-layer-2) 58%,transparent),'
          + 'color-mix(in srgb,var(--dsw-alias-bg-layer-2) 30%,transparent));'
          + 'box-shadow:inset 0 0 0 .5px color-mix(in srgb,var(--dsw-alias-border-l2) 60%,transparent),'
          + '0 1px 2px color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent);'
          + 'transition:background-color .16s ease,box-shadow .16s ease,transform .16s ease}')
        parts.push(tool + '::before{content:"";position:absolute;left:5px;top:9px;bottom:9px;width:2px;'
          + 'border-radius:2px;background:var(--dsw-alias-label-caption);opacity:.55;transition:background-color .16s ease,opacity .16s ease}')
        parts.push('@media (hover:hover){' + tool + ':hover{'
          + 'background:linear-gradient(180deg,'
          + 'color-mix(in srgb,var(--dsw-alias-bg-layer-2) 78%,transparent),'
          + 'color-mix(in srgb,var(--dsw-alias-bg-layer-2) 46%,transparent));'
          + 'box-shadow:inset 0 0 0 .5px color-mix(in srgb,var(--dsw-alias-border-l2) 88%,transparent),'
          + '0 4px 16px color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}}')
        parts.push(tool + ':has([aria-expanded="true"]){'
          + 'background:linear-gradient(180deg,'
          + 'color-mix(in srgb,var(--dsw-alias-bg-layer-2) 72%,transparent),'
          + 'color-mix(in srgb,var(--dsw-alias-bg-layer-2) 40%,transparent));'
          + 'box-shadow:inset 0 0 0 .5px color-mix(in srgb,var(--dsw-alias-border-l2) 85%,transparent)}')
        parts.push(tool + '[data-state="running"],' + tool + '[data-state="pending"]{'
          + 'background:linear-gradient(180deg,'
          + 'color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,var(--dsw-alias-bg-layer-2)),'
          + 'color-mix(in srgb,var(--dsw-alias-bg-layer-2) 42%,transparent));'
          + 'box-shadow:inset 0 0 0 .5px color-mix(in srgb,var(--dsw-alias-state-business-primary) 45%,transparent)}')
        parts.push(tool + '[data-state="running"]::before,' + tool + '[data-state="pending"]::before{'
          + 'background:var(--dsw-alias-state-business-primary);opacity:1;'
          + 'animation:dshST_toolPulse 1.6s ease-in-out infinite}')
        parts.push(tool + '[data-state="error"]{'
          + 'background:linear-gradient(180deg,'
          + 'color-mix(in srgb,var(--dsw-alias-state-error-primary) 9%,var(--dsw-alias-bg-layer-2)),'
          + 'color-mix(in srgb,var(--dsw-alias-bg-layer-2) 42%,transparent));'
          + 'box-shadow:inset 0 0 0 .5px color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent)}')
        parts.push(tool + '[data-state="error"]::before{background:var(--dsw-alias-state-error-primary);opacity:1}')
        parts.push('@keyframes dshST_toolPulse{0%,100%{opacity:1}50%{opacity:.35}}')
        parts.push(nested + '{margin:0;padding:0;border-radius:0;background:transparent;box-shadow:none}')
        parts.push(nested + '::before{display:none}')
        parts.push('@media (prefers-reduced-motion:reduce){' + tool + '{transition:none}'
          + tool + '[data-state="running"]::before,' + tool + '[data-state="pending"]::before{animation:none}}')
        parts.push('@media (forced-colors:active){' + tool + '{background:Canvas;box-shadow:none;color:CanvasText}'
          + tool + '::before{background:Highlight}}')
      }

      if (s.stepPanel) {
        // The panel lives in the composer stack, in flow above the input, so
        // it never covers the transcript (an absolute card overlapped the last
        // tool card). The list itself scrolls rather than growing without
        // bound.
        // Match the composer card exactly: the stack owns the side clearance,
        // the card owns the same max-width as the input surface, so the panel
        // and the input box share one right/left edge.
        parts.push('.dshST_root{box-sizing:border-box;width:100%;display:flex;justify-content:center;'
          + 'padding:0 var(--dsh-composer-side-clearance,16px) 4px;pointer-events:none}')
        parts.push('.dshST_card{--dshST-accent:' + s.stepPanelAccent + ';box-sizing:border-box;width:100%;'
          + 'max-width:var(--dsh-composer-card-max-width,680px);margin:0 auto;'
          + 'pointer-events:auto;overflow:hidden;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;'
          + 'color:var(--dsw-alias-label-secondary);font-size:calc(var(--dsh-content-font-size-secondary,13px) - 2px);'
          + 'background:color-mix(in srgb,var(--dsw-alias-bg-base) 90%,transparent);'
          + 'box-shadow:0 10px 28px color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent);'
          + 'backdrop-filter:blur(12px)}')
        parts.push('.dshST_head{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);'
          + 'align-items:center;gap:8px;padding:6px 10px;'
          + 'border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-border-l2) 60%,transparent);'
          + 'color:var(--dsw-alias-label-tertiary);font-size:11px}')
        parts.push('.dshST_title{font-weight:600;letter-spacing:.02em;min-width:0;overflow:hidden;'
          + 'text-overflow:ellipsis;white-space:nowrap}')
        parts.push('.dshST_more,.dshST_time{font-variant-numeric:tabular-nums}')
        parts.push('.dshST_more{justify-self:end;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}')
        parts.push('.dshST_live{display:inline-flex;align-items:center;gap:6px;justify-self:center;flex:none;'
          + 'max-width:100%;overflow:hidden;color:var(--dsw-alias-label-tertiary);'
          + 'font-variant-numeric:tabular-nums;white-space:nowrap}')
        parts.push('.dshST_livePhase{max-width:180px;overflow:hidden;text-overflow:ellipsis;'
          + 'color:var(--dsw-alias-label-secondary);font-weight:500}')
        parts.push('.dshST_liveSep{color:var(--dsw-alias-separator-primary)}')
        parts.push('.dshST_liveTime,.dshST_liveActivity{min-width:0;overflow:hidden;text-overflow:ellipsis}')
        parts.push('@keyframes dshST_pulse{0%,100%{opacity:1}50%{opacity:.45}}')
        parts.push('.dshST_liveDot{width:6px;height:6px;border-radius:50%;flex:none;'
          + 'background:var(--dsw-alias-state-business-primary);animation:dshST_pulse 1.8s ease-in-out infinite}')
        parts.push('.dshST_live[data-stalled] .dshST_liveDot{background:var(--dsw-alias-state-warn-primary);animation:none}')
        parts.push('.dshST_live[data-stalled] .dshST_liveActivity{color:var(--dsw-alias-state-warn-primary)}')
        parts.push('@media (prefers-reduced-motion:reduce){.dshST_liveDot{animation:none}}')
        // While the panel is on screen it owns the capsule; the standalone
        // absolute strip would otherwise land on the panel's header.
        if (s.runStrip) parts.push('html[data-dsh-sp-panel-visible] .dshRS_root{display:none!important}')
        parts.push('.dshST_rows{display:flex;flex-direction:column;gap:1px;max-height:40vh;overflow-y:auto;padding:4px;overscroll-behavior:contain}')
        parts.push('.dshST_row{display:flex;align-items:center;gap:8px;min-width:0;padding:3px 8px;border-radius:8px;line-height:18px}')
        parts.push('.dshST_dot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-label-tertiary)}')
        parts.push('.dshST_action{flex:none;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
          + 'color:var(--dsw-alias-label-primary);font-weight:500}')
        parts.push('.dshST_object{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
          + 'color:var(--dsw-alias-label-tertiary);font-family:var(--dsh-font-mono,ui-monospace,monospace)}')
        parts.push('.dshST_state{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px}')
        parts.push('.dshST_time{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px}')
        if (s.stepPanelPhaseColors) {
          parts.push('.dshST_row[data-kind="thinking"] .dshST_dot{background:var(--dsw-alias-label-tertiary)}')
          parts.push('.dshST_row[data-kind="reply"] .dshST_dot{background:var(--dsw-alias-label-secondary)}')
          parts.push('.dshST_row[data-kind="tool"][data-state="running"] .dshST_dot,'
            + '.dshST_row[data-kind="tool"][data-state="pending"] .dshST_dot{background:var(--dshST-accent)}')
          parts.push('.dshST_row[data-state="done"] .dshST_dot{background:var(--dsw-alias-state-success-primary)}')
          parts.push('.dshST_row[data-state="error"] .dshST_dot{background:var(--dsw-alias-state-error-primary)}')
          parts.push('.dshST_row[data-state="running"] .dshST_state,.dshST_row[data-state="pending"] .dshST_state{color:var(--dshST-accent)}')
          parts.push('.dshST_row[data-state="error"] .dshST_state{color:var(--dsw-alias-state-error-primary)}')
        }
        if (s.stepPanelMotion) {
          parts.push('@keyframes dshST_in{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}')
          parts.push('.dshST_row{animation:dshST_in 160ms cubic-bezier(.2,.7,.3,1)}')
          parts.push('@media (prefers-reduced-motion:reduce){.dshST_row{animation:none}}')
        }
        parts.push('@media (forced-colors:active){.dshST_card{border-color:CanvasText;background:Canvas;color:CanvasText}'
          + '.dshST_dot{background:Highlight}}')
        if (s.replaceToolRows) {
          parts.push('html[data-dsh-sp-tools-hidden] [data-chat-flow] [data-tool]{display:none!important}')
        }
      }

      if (s.translation) {
        // Toolbar above the expanded reasoning body. The body itself is Chat's
        // own compact Markdown Factory, so no typography is duplicated here.
        parts.push('.dshTR_root{display:block}')
        parts.push('.dshTR_bar{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:2px 0 4px;'
          + 'color:var(--dsw-alias-label-tertiary);font-size:11px}')
        parts.push('.dshTR_toggle{appearance:none;border:0;background:none;padding:1px 2px;border-radius:5px;'
          + 'color:var(--dsw-alias-label-tertiary);font:inherit;cursor:pointer}')
        parts.push('.dshTR_toggle:hover{color:var(--dsw-alias-label-secondary);text-decoration:underline}')
        parts.push('.dshTR_toggle:disabled{opacity:.55;cursor:default;text-decoration:none}')
        parts.push('.dshTR_note{color:var(--dsw-alias-label-tertiary)}')
        parts.push('.dshTR_root[data-state="failed"] .dshTR_note{color:var(--dsw-alias-state-warn-primary)}')
        parts.push('.dshTR_root[data-state="unavailable"] .dshTR_note{color:var(--dsw-alias-state-warn-primary)}')
      }

      return parts.join('')
    }

    /** Settings-page styles; mounted whether or not the decoration is enabled. */
    const PAGE_CSS = [
      '.dshSPS_page{display:flex;flex-direction:column;gap:18px;max-width:860px;color:var(--dsw-alias-label-primary);color-scheme:inherit;background:transparent}',
      '.dshSPS_head{display:flex;flex-direction:column;gap:4px}',
      '.dshSPS_title{margin:0;font-size:15px;font-weight:600;line-height:22px}',
      '.dshSPS_intro{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}',
      '.dshSPS_meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
      '.dshSPS_badge{display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:999px;font-size:11px;line-height:20px;color:var(--dsw-alias-state-warn-primary);border:.5px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary) 45%,transparent)}',
      '.dshSPS_headTop{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}',
      '.dshSPS_headText{display:flex;flex-direction:column;gap:4px;min-width:0}',
      '.dshSPS_presets{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding-top:2px}',
      '.dshSPS_presetsLabel{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}',
      '.dshSPS_presetBtn{height:24px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:11px;line-height:22px;cursor:pointer}',
      '.dshSPS_presetBtn:hover{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}',
      '.dshSPS_presetBtn[data-active=true]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent)}',
      '.dshSPS_presetBtn:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}',
      '.dshSPS_presetsHint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}',
      '.dshSPS_board{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:18px;align-items:start}',

      '.dshSPS_section{display:flex;flex-direction:column;gap:10px;min-width:0}',
      '.dshSPS_sectionHead{display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0}',
      '.dshSPS_sectionHeading{display:flex;align-items:baseline;gap:10px;min-width:0;overflow:hidden}',
      '.dshSPS_sectionTitle{margin:0;font-size:12px;font-weight:600;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.dshSPS_sectionNote{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',

      '.dshSPS_master{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 14px;border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}',
      '.dshSPS_masterText{display:flex;flex-direction:column;gap:3px;min-width:0}',
      '.dshSPS_masterTitle{font-size:14px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-primary)}',
      '.dshSPS_masterHint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',

      '.dshSPS_grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(196px,1fr));gap:10px;align-items:stretch}',
      '.dshSPS_tile{display:flex;flex-direction:column;gap:8px;padding:12px;border:.5px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);min-width:0}',
      '.dshSPS_tile[data-off=true]{opacity:.5}',
      '.dshSPS_tileTop{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;min-width:0}',
      '.dshSPS_tileTitle{font-size:13px;font-weight:500;line-height:18px;color:var(--dsw-alias-label-primary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshSPS_tileHint{font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary);margin-top:auto}',

      '.dshSPS_line{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 12px;border:.5px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}',
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

      '.dshSPS_seg{display:inline-flex;gap:2px;padding:2px;border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}',
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
      '.dshSPS_textWrap,.dshSPS_colorWrap{display:inline-flex;align-items:center;gap:6px;min-width:0}',
      '.dshSPS_inputText{width:100%;min-width:0;text-align:left;font-family:ui-monospace,monospace;font-size:12px}',
      '.dshSPS_swatch{flex:none;width:16px;height:16px;border-radius:4px;border:.5px solid var(--dsw-alias-border-l2)}',

      '.dshSPS_foot{display:flex;flex-wrap:wrap;align-items:center;gap:12px}',
      '.dshSPS_button{height:28px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:12px;line-height:26px;cursor:pointer}',
      '.dshSPS_button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}',
      '.dshSPS_button:disabled{opacity:.45;cursor:default}',
      '.dshSPS_button:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}',
      '.dshSPS_button[data-primary=true]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.dshSPS_footHint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}',
      '.dshSPS_linkBtn{flex:none;height:22px;padding:0 6px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);font-family:inherit;font-size:11px;line-height:22px;cursor:pointer}',
      '.dshSPS_linkBtn:hover{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary)}',
      '.dshSPS_linkBtn:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}',

      '.dshSPS_card{display:flex;flex-direction:column;gap:10px;padding:12px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-layer-1)}',
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

      '.dshSPS_preview{display:flex;flex-direction:column;gap:10px;padding:12px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-layer-1)}',
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
      '.dshSPS_demoLines{display:flex;flex-direction:column;gap:6px}',
      '.dshSPS_demoPanel{--dshSPS-accent:var(--dsw-alias-brand-primary);border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);overflow:hidden;font-size:11px;line-height:16px}',
      '.dshSPS_demoPanelHead{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:8px;padding:5px 8px;border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-border-l2) 55%,transparent);color:var(--dsw-alias-label-tertiary)}',
      '.dshSPS_demoPanelTitle{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshSPS_demoPanelLive{display:inline-flex;align-items:center;gap:5px;justify-self:center;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.dshSPS_demoPanelDot{width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-state-business-primary);animation:dshSPS_pulse 1.8s ease-in-out infinite}',
      '.dshSPS_demoPanelMore{justify-self:end;color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
      '.dshSPS_demoRow{display:flex;align-items:center;gap:7px;padding:3px 8px;min-width:0}',
      '.dshSPS_demoRowDot{width:5px;height:5px;border-radius:50%;flex:none;background:var(--dsw-alias-label-tertiary)}',
      '.dshSPS_demoRowAction{flex:none;max-width:36%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}',
      '.dshSPS_demoRowObject{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,monospace}',
      '.dshSPS_demoRowState,.dshSPS_demoRowTime{flex:none;color:var(--dsw-alias-label-tertiary);font-size:10px;font-variant-numeric:tabular-nums}',
      '.dshSPS_demoPanel[data-motion=true] .dshSPS_demoRow{animation:dshSPS_rowIn 160ms cubic-bezier(.2,.7,.3,1)}',
      '.dshSPS_demoPanel[data-motion=true] .dshSPS_demoRow:nth-child(2){animation-delay:40ms}',
      '.dshSPS_demoPanel[data-motion=true] .dshSPS_demoRow:nth-child(3){animation-delay:80ms}',
      '.dshSPS_demoPanel[data-phase=true] .dshSPS_demoRow[data-state=running] .dshSPS_demoRowDot{background:var(--dshSPS-accent)}',
      '.dshSPS_demoPanel[data-phase=true] .dshSPS_demoRow[data-state=running] .dshSPS_demoRowState{color:var(--dshSPS-accent)}',
      '.dshSPS_demoPanel[data-phase=true] .dshSPS_demoRow[data-kind=reply] .dshSPS_demoRowDot{background:var(--dsw-alias-label-secondary)}',
      '.dshSPS_demoTool{position:relative;display:flex;align-items:center;gap:8px;padding:5px 9px 5px 12px;border-radius:11px;background:var(--dsw-alias-bg-base);box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}',
      '.dshSPS_demoTool::before{content:"";position:absolute;left:5px;top:8px;bottom:8px;width:2px;border-radius:2px;background:var(--dsw-alias-state-success-primary);opacity:.7}',
      '.dshSPS_demoToolMark{color:var(--dsw-alias-label-caption)}',
      '.dshSPS_demoToolTitle{font-weight:500;color:var(--dsw-alias-label-primary)}',
      '.dshSPS_demoToolSummary{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,monospace}',
      '.dshSPS_demoToolState{flex:none;color:var(--dsw-alias-label-tertiary)}',
      '.dshSPS_demoTranslate{display:flex;align-items:center;gap:8px;padding:2px 2px 0;color:var(--dsw-alias-label-tertiary)}',
      '.dshSPS_demoTranslateBtn{flex:none;text-decoration:underline dotted;text-underline-offset:2px}',
      '.dshSPS_demoTranslateText{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}',
      '.dshSPS_test{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:10px 12px;border:.5px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}',
      '.dshSPS_testText{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.dshSPS_testTitle{font-size:13px;line-height:18px;color:var(--dsw-alias-label-primary)}',
      '.dshSPS_testHint{font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary)}',
      '.dshSPS_testControl{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;flex:1;min-width:0}',
      '@keyframes dshSPS_rowIn{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}',
      '@keyframes dshSPS_in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}',
      '@keyframes dshSPS_breath{0%,100%{opacity:.95}50%{opacity:.78}}',
      '@keyframes dshSPS_pulse{0%,100%{opacity:1}50%{opacity:.45}}',
      '@media (prefers-reduced-motion:reduce){.dshSPS_demoLine.dshSPS_demoIn,.dshSPS_demoCaret,.dshSPS_demoPillDot,.dshSPS_demoPanel[data-motion=true] .dshSPS_demoRow{animation:none}}',
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
          h('div', { className: 'dshSPS_sectionHeading' },
            h('h4', { className: 'dshSPS_sectionTitle' }, props.title),
            props.note === undefined ? null : h('span', { className: 'dshSPS_sectionNote' }, props.note)),
          props.onReset === undefined
            ? null
            : h('button', {
              type: 'button',
              className: 'dshSPS_linkBtn',
              title: props.resetHint ?? '',
              onClick: props.onReset,
            }, props.resetLabel ?? 'Reset')),
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
     * One pattern-validated text field inside the card grid.
     * @param {{ title: string, hint: string, option: string, value: string, t: Function, disabled?: boolean, swatch?: boolean, onChange: Function }} props - field state.
     * @returns {object} the card element.
     */
    function SettingsTextCard(props) {
      const rule = SPEC[props.option]
      const [draft, setDraft] = React.useState(String(props.value))
      React.useEffect(() => {
        setDraft(String(props.value))
      }, [props.value])
      const valid = rule.pattern.test(draft)
      return h('div', {
        className: 'dshSPS_tile',
        'data-off': props.disabled === true ? 'true' : 'false',
      },
        h('span', { className: 'dshSPS_tileTitle', title: props.title }, props.title),
        h('span', { className: props.swatch === true ? 'dshSPS_colorWrap' : 'dshSPS_textWrap' },
          props.swatch === true
            ? h('span', {
              className: 'dshSPS_swatch',
              'aria-hidden': true,
              style: { background: valid ? draft : String(props.value) },
            })
            : null,
          h('input', {
            className: 'dshSPS_input dshSPS_inputText',
            type: 'text',
            value: draft,
            spellCheck: false,
            autoComplete: 'off',
            disabled: props.disabled === true ? true : undefined,
            'aria-label': props.title,
            'aria-invalid': valid ? undefined : 'true',
            onChange: (event) => {
              setDraft(event.target.value)
              if (rule.pattern.test(event.target.value)) props.onChange(event.target.value)
            },
            onBlur: () => {
              if (!valid) setDraft(String(props.value))
            },
          })),
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
    async function apiCall(path, method = 'GET', body) {
      if (typeof fetch !== 'function') {
        return { ok: false, error: 'no-fetch', message: 'fetch is unavailable in this browser' }
      }
      try {
        const payload = method === 'POST' ? JSON.stringify(body ?? {}) : undefined
        const response = await fetch('./api/stream-polish' + path, {
          method,
          headers: method === 'POST' ? { 'content-type': 'application/json' } : undefined,
          body: payload,
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
    /** Preset name list shared by the hero shortcuts and the tests. */
    const PRESET_NAMES = ['calm', 'standard', 'full']

    /**
     * Build one visual preset patch.
     *
     * Presets never turn machine translation on: it sends content to an
     * external endpoint, so enabling it stays an explicit privacy decision.
     * @param {string} name - `calm` | `standard` | `full`.
     * @returns {Record<string, unknown>} every option, plus the preset deltas.
     */
    function presetPatch(name) {
      const base = { ...DEFAULTS }
      if (name === 'calm') {
        return {
          ...base,
          blockFadeMs: 120,
          caretPeriodMs: 1600,
          settleMs: 220,
          runStrip: false,
          stepPanel: false,
          replaceToolRows: false,
          toolCardPolish: true,
          translation: false,
        }
      }
      if (name === 'full') {
        return {
          ...base,
          runStrip: true,
          stepPanel: true,
          stepPanelRows: 8,
          replaceToolRows: false,
          toolCardPolish: true,
          stepPanelMotion: true,
          stepPanelPhaseColors: true,
          translation: false,
        }
      }
      return base
    }

    /**
     * Whether the accepted settings equal one preset's patch.
     * @param {Record<string, unknown>} settings - resolved settings.
     * @param {string} name - preset name.
     * @returns {boolean} true when every preset key matches.
     */
    function presetActive(settings, name) {
      const patch = presetPatch(name)
      return Object.entries(patch).every(([key, value]) => settings[key] === value)
    }

    /**
     * A continuously replaying miniature of every visual surface.
     *
     * The stage remounts on a signature change, so moving any control restarts
     * the entry animations immediately; while `playing` it also remounts every
     * 4.2 seconds so the animation never sits still. That is the "always
     * animating" default the page promises.
     */
    function PreviewPanel(props) {
      const settings = props.settings
      const t = props.t
      const [cycle, setCycle] = React.useState(0)
      const [playing, setPlaying] = React.useState(true)

      const signature = [
        settings.enabled, settings.blockFade, settings.blockFadeMs,
        settings.caret, settings.caretPeriodMs, settings.settleFade, settings.settleMs,
        settings.runStrip, settings.showElapsed, settings.showActivity,
        settings.stepPanel, settings.stepPanelRows, settings.stepPanelAccent,
        settings.stepPanelMotion, settings.stepPanelPhaseColors, settings.replaceToolRows,
        settings.toolCardPolish, settings.translation, settings.translationProvider,
        settings.translationTargetLanguage,
      ].join('|')

      // A control change remounts the stage, so its animation restarts at once.
      React.useEffect(() => {
        setCycle((value) => value + 1)
      }, [signature])

      // Default state: keep the miniature moving. Pausing only stops this
      // loop; the controls still replay it on the next change.
      React.useEffect(() => {
        if (!playing || !settings.enabled) return undefined
        const timer = window.setInterval(() => setCycle((value) => value + 1), 4200)
        return () => window.clearInterval(timer)
      }, [playing, settings.enabled])

      const stageStyle = {
        '--dshSPS-fade': settings.blockFadeMs + 'ms',
        '--dshSPS-period': settings.caretPeriodMs + 'ms',
        '--dshSPS-accent': settings.stepPanelAccent,
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
        : null

      let panel = null
      if (settings.enabled && settings.stepPanel) {
        const demoRows = [
          { key: 'think', kind: 'thinking', state: 'done', action: t('step.thinking'), object: t('preview.thinkingSample'), time: '1.2s' },
          { key: 'tool', kind: 'tool', state: 'running', action: t('step.tool.bash'), object: 'npm test', time: '00:12' },
          { key: 'reply', kind: 'reply', state: 'done', action: t('step.reply'), object: t('preview.replySample'), time: '3.4s' },
        ]
        const visible = Math.max(1, Math.min(settings.stepPanelRows, demoRows.length))
        const hidden = demoRows.length - visible
        panel = h('div', {
          className: 'dshSPS_demoPanel',
          'data-motion': settings.stepPanelMotion ? 'true' : 'false',
          'data-phase': settings.stepPanelPhaseColors ? 'true' : 'false',
        },
          h('div', { className: 'dshSPS_demoPanelHead' },
            h('span', { className: 'dshSPS_demoPanelTitle' }, t('preview.stepHeader')),
            settings.runStrip
              ? h('span', { className: 'dshSPS_demoPanelLive' },
                h('span', { className: 'dshSPS_demoPanelDot' }),
                t('preview.phase'),
                settings.showElapsed ? ' · ' + t('preview.elapsed') : null)
              : null,
            hidden > 0
              ? h('span', { className: 'dshSPS_demoPanelMore' }, t('preview.earlier', { n: hidden }))
              : null),
          demoRows.slice(0, visible).map((row) => h('div', {
            key: row.key,
            className: 'dshSPS_demoRow',
            'data-kind': row.kind,
            'data-state': row.state,
          },
            h('span', { className: 'dshSPS_demoRowDot', 'aria-hidden': true }),
            h('span', { className: 'dshSPS_demoRowAction' }, row.action),
            h('span', { className: 'dshSPS_demoRowObject' }, row.object),
            h('span', { className: 'dshSPS_demoRowState' }, t('step.status.' + row.state)),
            h('span', { className: 'dshSPS_demoRowTime' }, row.time))))
      } else if (settings.enabled) {
        panel = h('div', { className: 'dshSPS_previewNote' }, t('preview.noPanel'))
      }

      let toolCard = null
      if (settings.enabled) {
        if (settings.replaceToolRows && settings.stepPanel) {
          toolCard = h('div', { className: 'dshSPS_previewNote' }, t('preview.replaced'))
        } else if (settings.toolCardPolish) {
          toolCard = h('div', { className: 'dshSPS_demoTool' },
            h('span', { className: 'dshSPS_demoToolMark', 'aria-hidden': true }, '›'),
            h('span', { className: 'dshSPS_demoToolTitle' }, 'Bash'),
            h('span', { className: 'dshSPS_demoToolSummary' }, 'npm test'),
            h('span', { className: 'dshSPS_demoToolState', 'data-state': 'done' }, t('step.status.done')))
        } else {
          toolCard = h('div', { className: 'dshSPS_previewNote' }, t('preview.noTool'))
        }
      }

      const translation = settings.enabled && settings.translation
        ? h('div', { className: 'dshSPS_demoTranslate' },
          h('span', { className: 'dshSPS_demoTranslateBtn' }, t('preview.translationToolbar')),
          h('span', { className: 'dshSPS_demoTranslateText' }, t('preview.translationSample')))
        : null

      return h('div', { className: 'dshSPS_preview' },
        h('div', { className: 'dshSPS_previewBar' },
          h('span', { className: 'dshSPS_previewTag' }, t('preview.live')),
          h('span', { className: 'dshSPS_previewHint' }, t('preview.hint')),
          h('button', {
            type: 'button',
            className: 'dshSPS_button',
            disabled: !settings.enabled,
            onClick: () => setPlaying((value) => !value),
          }, playing ? t('preview.pause') : t('preview.play')),
          h('button', {
            type: 'button',
            className: 'dshSPS_button',
            disabled: !settings.enabled,
            onClick: () => setCycle((value) => value + 1),
          }, t('preview.replay'))),
        settings.enabled
          ? h('div', { className: 'dshSPS_previewStage', key: cycle, style: stageStyle, 'data-playing': playing ? 'true' : 'false' },
            h('div', { className: 'dshSPS_demoLines' },
              h('p', { className: 'dshSPS_demoLine' }, t('preview.settled')),
              h('p', {
                className: 'dshSPS_demoLine dshSPS_demoIn',
                'data-fade': settings.blockFade ? 'true' : 'false',
              }, t('preview.fading', { ms: settings.blockFadeMs })),
              h('p', { className: 'dshSPS_demoLine' },
                t('preview.caret'),
                settings.caret ? h('span', { className: 'dshSPS_demoCaret', 'aria-hidden': true }) : null)),
            !settings.stepPanel && capsule ? capsule : null,
            panel,
            toolCard,
            translation)
          : h('div', { className: 'dshSPS_previewEmpty' }, t('preview.off')))
    }

    /** One route probe: translate a fixed English sentence with the current choices. */
    function TranslationTest(props) {
      const { settings, t } = props
      const [state, setState] = React.useState({ busy: false, text: null, code: null })
      const available = readWireVersion() === WIRE_VERSION && readCapabilities().translation.available
      const run = async () => {
        setState({ busy: true, text: null, code: null })
        const result = await apiCall('/translate', 'POST', {
          text: 'The quick brown fox jumps over the lazy dog.',
          provider: settings.translationProvider,
          targetLanguage: resolveTargetLanguage(settings.translationTargetLanguage),
        })
        if (result?.ok === true) {
          setState({ busy: false, text: String(result.text ?? ''), code: null })
        } else {
          setState({ busy: false, text: null, code: String(result?.code ?? result?.error ?? 'FAILED') })
        }
      }
      return h('div', { className: 'dshSPS_test' },
        h('div', { className: 'dshSPS_testText' },
          h('span', { className: 'dshSPS_testTitle' }, t('settings.translationTest')),
          h('span', { className: 'dshSPS_testHint' }, t('settings.translationTestHint'))),
        h('div', { className: 'dshSPS_testControl' },
          h('button', {
            type: 'button',
            className: 'dshSPS_button',
            disabled: state.busy || !available,
            onClick: () => { void run() },
          }, state.busy ? t('settings.translationTesting') : t('settings.translationTest')),
          state.text === null
            ? null
            : h('span', { className: 'dshSPS_status', 'data-tone': 'ok' },
              t('settings.translationTestOk', { text: state.text })),
          state.code === null
            ? null
            : h('span', { className: 'dshSPS_status', 'data-tone': 'error' },
              t('settings.translationTestFail', { code: state.code }))))
    }

    /** The Stream polish page inside Settings -> Plugins. */
    function SettingsPage(props) {
      const settings = useSettings()
      const t = typeof props.t === 'function' ? props.t : translate
      const update = (patch) => store.update(patch)

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
        const panelOff = !settings.stepPanel
        const translationOff = !settings.translation
        const resetGroup = (keys) => {
          const base = store.baseline()
          const patch = {}
          for (const key of keys) patch[key] = base[key]
          update(patch)
        }
        const groups = {
          display: ['enabled', 'blockFade', 'caret', 'settleFade', 'runStrip', 'showElapsed', 'showActivity', 'toolCardPolish'],
          timing: ['blockFadeMs', 'caretPeriodMs', 'settleMs', 'stallMs'],
          steps: ['stepPanel', 'stepPanelRows', 'stepPanelAccent', 'stepPanelMotion', 'stepPanelPhaseColors', 'replaceToolRows'],
          translation: ['translation', 'translationProvider', 'translationTargetLanguage', 'translationTimeoutMs'],
          log: ['logLevel'],
        }
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
        const sectionReset = (group) => ({
          onReset: () => resetGroup(groups[group]),
          resetLabel: t('settings.resetGroup'),
          resetHint: t('settings.resetGroupHint'),
        })

        return h('div', { className: 'dshSPS_page' },
          h('header', { className: 'dshSPS_head' },
            h('div', { className: 'dshSPS_headTop' },
              h('div', { className: 'dshSPS_headText' },
                h('h3', { className: 'dshSPS_title' }, t('settings.title')),
                h('p', { className: 'dshSPS_intro' }, t('settings.intro'))),
              h('div', { className: 'dshSPS_meta' },
                store.isDefault() ? null : h('span', { className: 'dshSPS_badge' }, t('settings.badgeLocal')))),
            h('div', { className: 'dshSPS_presets' },
              h('span', { className: 'dshSPS_presetsLabel' }, t('settings.presets')),
              PRESET_NAMES.map((name) => h('button', {
                key: name,
                type: 'button',
                className: 'dshSPS_presetBtn',
                'data-active': presetActive(settings, name) ? 'true' : undefined,
                onClick: () => update(presetPatch(name)),
              }, t('settings.preset.' + name))),
              h('span', { className: 'dshSPS_presetsHint' }, t('settings.presetHint')))),

          h(PreviewPanel, { settings, t }),

          h('div', { className: 'dshSPS_board' },
            h(SettingsSection, {
              title: t('settings.display'),
              note: t('settings.displayNote'),
              ...sectionReset('display'),
            },
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
                toggle('showActivity', !settings.enabled || stripOff),
                toggle('toolCardPolish', !settings.enabled))),

            h(SettingsSection, {
              title: t('settings.steps'),
              note: t('settings.stepsNote'),
              ...sectionReset('steps'),
            },
              h(SettingsMaster, {
                title: t('settings.stepPanel'),
                hint: t('settings.stepPanelHint'),
                label: t('settings.stepPanel'),
                checked: settings.stepPanel,
                onChange: (next) => update({ stepPanel: next }),
              }),
              h('div', { className: 'dshSPS_grid' },
                h(SettingsNumberCard, {
                  key: 'stepPanelRows',
                  title: t('settings.stepPanelRows'),
                  hint: t('settings.stepPanelRowsHint'),
                  option: 'stepPanelRows',
                  value: settings.stepPanelRows,
                  t,
                  disabled: !settings.enabled || panelOff,
                  onChange: (next) => update({ stepPanelRows: next }),
                }),
                h(SettingsTextCard, {
                  key: 'stepPanelAccent',
                  title: t('settings.stepPanelAccent'),
                  hint: t('settings.stepPanelAccentHint'),
                  option: 'stepPanelAccent',
                  value: settings.stepPanelAccent,
                  swatch: true,
                  t,
                  disabled: !settings.enabled || panelOff,
                  onChange: (next) => update({ stepPanelAccent: next }),
                }),
                toggle('stepPanelMotion', !settings.enabled || panelOff),
                toggle('stepPanelPhaseColors', !settings.enabled || panelOff),
                toggle('replaceToolRows', !settings.enabled || panelOff))),

            h(SettingsSection, {
              title: t('settings.timing'),
              note: t('settings.timingNote'),
              ...sectionReset('timing'),
            },
              h('div', { className: 'dshSPS_grid' },
                field('blockFadeMs', !settings.enabled || !settings.blockFade),
                field('caretPeriodMs', !settings.enabled || caretOff),
                field('settleMs', !settings.enabled || caretOff || !settings.settleFade),
                field('stallMs', !settings.enabled))),

            h(SettingsSection, {
              title: t('settings.translation'),
              note: t('settings.translationNote'),
              ...sectionReset('translation'),
            },
              h(SettingsMaster, {
                title: t('settings.translationEnabled'),
                hint: t('settings.translationEnabledHint'),
                label: t('settings.translationEnabled'),
                checked: settings.translation,
                onChange: (next) => update({ translation: next }),
              }),
              readWireVersion() !== WIRE_VERSION
                ? h('div', { className: 'dshSPS_status', 'data-tone': 'error' }, t('settings.translationStaleHost'))
                : readCapabilities().translation.available
                  ? null
                  : h('div', { className: 'dshSPS_status', 'data-tone': 'error' }, t('settings.translationUnavailable')),
              h('div', { className: 'dshSPS_line' },
                h('span', { className: 'dshSPS_lineHint' }, t('settings.translationPrivacy'))),
              h('div', { className: 'dshSPS_grid' },
                h('div', { className: 'dshSPS_tile' },
                  h('span', { className: 'dshSPS_tileTitle' }, t('settings.translationProvider')),
                  h(SettingsSegments, {
                    group: 'translationProvider',
                    label: t('settings.translationProvider'),
                    ids: TRANSLATION_PROVIDERS,
                    value: settings.translationProvider,
                    t,
                    labelFor: (id) => id,
                    onChange: (next) => update({ translationProvider: next }),
                  }),
                  h('span', { className: 'dshSPS_tileHint' }, t('settings.translationProviderHint'))),
                h(SettingsTextCard, {
                  key: 'translationTargetLanguage',
                  title: t('settings.translationTargetLanguage'),
                  hint: t('settings.translationTargetLanguageHint'),
                  option: 'translationTargetLanguage',
                  value: settings.translationTargetLanguage,
                  t,
                  disabled: translationOff,
                  onChange: (next) => update({ translationTargetLanguage: next }),
                }),
                h(SettingsNumberCard, {
                  key: 'translationTimeoutMs',
                  title: t('settings.translationTimeoutMs'),
                  hint: t('settings.range', { min: SPEC.translationTimeoutMs.min, max: SPEC.translationTimeoutMs.max }),
                  option: 'translationTimeoutMs',
                  value: settings.translationTimeoutMs,
                  t,
                  disabled: translationOff,
                  onChange: (next) => update({ translationTimeoutMs: next }),
                })),
              h(TranslationTest, { settings, t })),

            h(SettingsSection, {
              title: t('settings.log'),
              ...sectionReset('log'),
            },
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
                })))),

          h(UpdatePanel, { t }),

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

    /* ------------------------------------------------------------------ *
     * This-turn step panel
     *
     * One `conversation.input.dock` entry renders a compact list above the
     * composer. It reads the Chat snapshot through the session-scoped
     * `useChat` standard prop and never touches renderer state: reasoning and
     * reply blocks come from materialized Assistant nodes, tool rows from
     * Tool-result nodes plus the live `runningCalls` slice, and running
     * durations tick once a second.
     * ------------------------------------------------------------------ */

    /** Tool-argument fields used as the row's "object", most specific first. */
    const ARG_KEYS = ['command', 'file_path', 'path', 'pattern', 'query', 'url', 'description', 'prompt', 'agent', 'name']

    /** Flatten one value into a bounded single line. */
    function clip(text, limit) {
      const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
      return flat.length > limit ? flat.slice(0, limit - 1) + '…' : flat
    }

    /** First non-empty line of a reasoning or reply block. */
    function firstLineOf(text, limit) {
      for (const line of String(text ?? '').split(/\r?\n/)) {
        if (line.trim() !== '') return clip(line, limit)
      }
      return ''
    }

    /** Read one readable string out of a lazy tool-argument view. */
    function argText(args, keys, limit) {
      if (args === null || typeof args !== 'object') return ''
      for (const key of keys) {
        try {
          const value = typeof args.text === 'function' ? args.text(key) : undefined
          if (typeof value === 'string' && value.trim() !== '') return clip(value, limit)
          const prefix = typeof args.textPrefix === 'function' ? args.textPrefix(key, limit) : undefined
          if (typeof prefix === 'string' && prefix.trim() !== '') return clip(prefix, limit)
        } catch {
          // A streaming view that cannot answer this field simply has no object.
        }
      }
      return ''
    }

    /** Format one row's duration without inventing precision. */
    function rowDuration(ms) {
      if (!Number.isFinite(ms) || ms < 0) return ''
      if (ms < 1000) return Math.round(ms) + 'ms'
      if (ms < 60000) return (ms / 1000).toFixed(1) + 's'
      return clock(ms)
    }

    /** Resolve the turn a materialized node belongs to. */
    function nodeTurn(node) {
      if (node === null || typeof node !== 'object') return undefined
      if (typeof node.turn === 'number') return node.turn
      const location = node.location
      if (location === null || typeof location !== 'object') return undefined
      if (location.kind === 'step' || location.kind === 'turn') return location.turn?.turn
      return undefined
    }

    /** Step start timestamp from the Chat timeline, when the window loaded it. */
    function stepStartOf(turnLocation, step) {
      if (turnLocation === null || turnLocation === undefined) return undefined
      const location = Array.isArray(turnLocation.steps)
        ? turnLocation.steps.find((candidate) => candidate.step === step)
        : undefined
      const time = location?.start?.time
      return typeof time === 'number' ? time : undefined
    }

    /**
     * Project the latest turn into panel rows.
     *
     * Rows are ordered by Session seq (materialized nodes) and start time (live
     * calls). A finalized Assistant contributes its reasoning and reply blocks;
     * a live Assistant prefix contributes the same kinds with `running`. Tool
     * results carry their exact call→result duration; live calls tick with the
     * panel clock. The visible count comes from `stepPanelRows`; older rows
     * collapse into one counted line instead of disappearing silently.
     * @param {object} snapshot - Chat snapshot.
     * @param {Record<string, unknown>} settings - resolved settings.
     * @param {number} now - current clock for live rows.
     * @returns {{ turn: number | null, rows: Array<object>, hidden: number }} projection.
     */
    function buildSteps(snapshot, settings, now) {
      const order = snapshot?.timeline?.turnOrder
      if (!Array.isArray(order) || order.length === 0) return { turn: null, rows: [], hidden: 0 }
      const turn = order[order.length - 1]
      const turns = snapshot.timeline.turns
      const turnLocation = turns !== null && typeof turns === 'object' && typeof turns.get === 'function'
        ? turns.get(turn)
        : turns?.[turn]
      const legacy = snapshot.legacy ?? {}
      const rows = []
      const seenCalls = new Set()

      /** Append one finalized Assistant step's reasoning and reply blocks. */
      const pushAssistant = (blocks, anchor, duration, status, idPrefix) => {
        for (const block of blocks ?? []) {
          if (block.kind !== 'reasoning' && block.kind !== 'text') continue
          const object = firstLineOf(block.text, block.kind === 'reasoning' ? 56 : 72)
          if (object === '') continue
          rows.push({
            id: idPrefix + '-' + rows.length,
            order: anchor,
            kind: block.kind === 'reasoning' ? 'thinking' : 'reply',
            action: block.kind === 'reasoning' ? 'step.thinking' : 'step.reply',
            object,
            status,
            duration,
          })
        }
      }

      /** Append one Tool root, settled or live. */
      const pushTool = (root, anchor, idPrefix) => {
        if (root === null || typeof root !== 'object') return
        if (root.kind === 'tool-result') {
          if (typeof root.callId === 'string') seenCalls.add(root.callId)
          const object = argText(root.args, ARG_KEYS, 72)
            || (typeof root.call?.argsRaw === 'string' ? clip(root.call.argsRaw, 72) : '')
            || clip(root.name, 72)
          rows.push({
            id: idPrefix,
            order: anchor,
            kind: 'tool',
            action: typeof root.name === 'string' && root.name !== '' ? root.name : 'tool',
            object,
            status: root.isError ? 'error' : 'done',
            duration: typeof root.callTime === 'number' ? root.time - root.callTime : null,
          })
          return
        }
        if (typeof root.callId === 'string') seenCalls.add(root.callId)
        rows.push({
          id: idPrefix,
          order: anchor,
          kind: 'tool',
          action: typeof root.name === 'string' && root.name !== '' ? root.name : 'tool',
          object: argText(root.args, ARG_KEYS, 72),
          status: root.phase === 'preparing' ? 'pending' : 'running',
          duration: typeof root.time === 'number' ? now - root.time : null,
        })
      }

      const locations = snapshot.locations
      const nodes = snapshot.nodes
      const keys = locations !== undefined && locations !== null && typeof locations.getTurn === 'function'
        ? locations.getTurn(turn)
        : []
      let indexed = false

      if (Array.isArray(keys) && keys.length > 0 && nodes !== undefined && nodes !== null
        && typeof nodes.get === 'function') {
        indexed = true
        for (const key of keys) {
          const node = nodes.get(key)
          if (node === null || node === undefined || node.visibility !== 'visible') continue
          if (node.kind === 'assistant-step') {
            const data = node.data
            if (data === null || typeof data !== 'object' || data.status === 'running') continue
            const timing = data.finalNode?.timing
            const duration = timing === null || timing === undefined
              ? null
              : timing.completedTime - (timing.stepStartTime ?? timing.firstTokenTime ?? timing.completedTime)
            pushAssistant(data.blocks, node.anchorSeq, duration,
              data.status === 'interrupted' ? 'error' : 'done', 'n' + node.anchorSeq)
            continue
          }
          if (node.kind === 'tool-call') {
            pushTool(node.data?.root, node.anchorSeq, 'n' + node.anchorSeq)
          }
        }
      }

      if (!indexed) {
        // Fallback for a Host that publishes only the legacy slice: attribute
        // tools through the Assistant tool-call blocks that own their callId.
        const callTurn = new Map()
        for (const node of legacy.nodes ?? []) {
          if (node.kind !== 'assistant') continue
          for (const block of node.blocks ?? []) {
            if (block.kind === 'tool-call' && typeof block.callId === 'string') {
              callTurn.set(block.callId, node.turn)
            }
          }
        }
        for (const node of legacy.nodes ?? []) {
          if (node.kind === 'assistant') {
            if (node.turn !== turn) continue
            const timing = node.timing
            const duration = timing === null || timing === undefined
              ? null
              : timing.completedTime - (timing.stepStartTime ?? timing.firstTokenTime ?? timing.completedTime)
            pushAssistant(node.blocks, node.seq, duration, node.interrupted ? 'error' : 'done', 'a' + node.seq)
            continue
          }
          if (node.kind === 'tool-result' && callTurn.get(node.callId) === turn) {
            pushTool(node, node.seq, 't' + node.seq)
          }
        }
      }

      for (const call of legacy.runningCalls ?? []) {
        if (call === null || typeof call !== 'object') continue
        if (typeof call.turn === 'number' && call.turn !== turn) continue
        if (call.parentCallId !== undefined) continue
        if (typeof call.callId === 'string' && seenCalls.has(call.callId)) continue
        pushTool(call, typeof call.time === 'number' ? call.time : now, 'r' + String(call.callId ?? rows.length))
      }

      const partial = legacy.partial
      if (partial !== null && partial !== undefined && partial.turn === turn) {
        const start = stepStartOf(turnLocation, partial.step)
        const duration = start === undefined ? null : now - start
        for (const block of partial.blocks ?? []) {
          if (block.kind !== 'reasoning' && block.kind !== 'text') continue
          const object = firstLineOf(block.text, block.kind === 'reasoning' ? 56 : 72)
          if (object === '') continue
          rows.push({
            id: 'p' + partial.step + '-' + rows.length,
            order: Number.MAX_SAFE_INTEGER - 1,
            kind: block.kind === 'reasoning' ? 'thinking' : 'reply',
            action: block.kind === 'reasoning' ? 'step.thinking' : 'step.reply',
            object,
            status: 'running',
            duration,
          })
        }
      }

      rows.sort((left, right) => left.order - right.order)
      const limit = Number.isInteger(settings.stepPanelRows) ? settings.stepPanelRows : 5
      const hidden = Math.max(0, rows.length - limit)
      return { turn, rows: rows.slice(hidden), hidden }
    }

    /** Localize a tool name without inventing a label for an unknown plugin tool. */
    function toolActionLabel(t, name) {
      const lower = String(name ?? '').toLowerCase()
      const key = lower.startsWith('subagent') ? 'step.tool.subagent' : 'step.tool.' + lower
      const label = t(key)
      return label === key ? String(name || 'tool') : label
    }

    /** The compact this-turn step list rendered above the composer. */
    function StepPanel(props) {
      const settings = useSettings()
      const t = typeof props.t === 'function' ? props.t : translate
      const session = props.session
      const running = session !== undefined && session.running === true
      const [now, setNow] = React.useState(Date.now())
      const [visible, setVisible] = React.useState(running)
      const useChat = typeof props.useChat === 'function' ? props.useChat : () => undefined
      // While hidden, select a stable null so token publications do not rebuild
      // a list nobody can see.
      const snapshot = useChat((chat) => (visible ? chat : null))

      React.useEffect(() => {
        if (running) {
          setVisible(true)
          return undefined
        }
        // Match the run capsule's quiet-exit rule: keep the finished list
        // readable for a few seconds, then withdraw it from the composer.
        const timer = window.setTimeout(() => setVisible(false), 8000)
        return () => window.clearTimeout(timer)
      }, [running])

      React.useEffect(() => {
        if (!running) return undefined
        const timer = window.setInterval(() => setNow(Date.now()), 1000)
        return () => window.clearInterval(timer)
      }, [running])

      // Re-render on a phase change between the one-second clock ticks.
      const [, setRunTick] = React.useState(0)
      React.useEffect(() => runStore.subscribe(() => setRunTick((value) => value + 1)), [])

      const projected = snapshot === undefined || snapshot === null
        ? { turn: null, rows: [], hidden: 0 }
        : buildSteps(snapshot, settings, now)
      const rendered = visible && projected.rows.length > 0

      // The panel owns the live capsule while it is on screen: hide the
      // standalone run strip and, when configured, the native tool rows for
      // exactly as long as the panel is visible. Both return on cleanup.
      React.useEffect(() => {
        if (!rendered) return undefined
        const root = document.documentElement
        root.setAttribute('data-dsh-sp-panel-visible', '')
        if (settings.replaceToolRows) root.setAttribute('data-dsh-sp-tools-hidden', '')
        return () => {
          root.removeAttribute('data-dsh-sp-panel-visible')
          root.removeAttribute('data-dsh-sp-tools-hidden')
        }
      }, [rendered, settings.replaceToolRows])

      if (!settings.enabled || !settings.stepPanel || !rendered) return null

      const rows = projected.rows.map((row) => h('div', {
        key: row.id,
        className: 'dshST_row',
        'data-kind': row.kind,
        'data-state': row.status,
      },
        h('span', { className: 'dshST_dot', 'aria-hidden': true }),
        h('span', { className: 'dshST_action' }, row.kind === 'tool'
          ? toolActionLabel(t, row.action)
          : t(row.action)),
        row.object === '' ? null : h('span', { className: 'dshST_object', title: row.object }, row.object),
        h('span', { className: 'dshST_state' }, t('step.status.' + row.status)),
        row.duration === null ? null : h('span', { className: 'dshST_time' }, rowDuration(row.duration))))

      // The run capsule's content moves into the title bar while the panel is
      // visible; the standalone strip is hidden by the attribute above.
      let capsule = null
      if (settings.runStrip && running && runStore.running && runStore.sessionId === session.sessionId) {
        const elapsed = clock(now - runStore.phaseSince)
        const idle = Math.max(0, now - runStore.lastActivityAt)
        const stalled = idle >= settings.stallMs
        const phaseText = runStore.phase === 'tool'
          ? runStore.tool === 'commands'
            ? t('phase.commands')
            : t('phase.tool', { tool: runStore.tool })
          : runStore.phase === 'writing'
            ? t('phase.writing')
            : t('phase.thinking')
        const activityText = stalled
          ? t('stall', { n: Math.floor(idle / 1000) })
          : idle < 2000
            ? t('activity.now')
            : idle < 60000
              ? t('activity.seconds', { n: Math.floor(idle / 1000) })
              : t('activity.minutes', { m: Math.floor(idle / 60000), n: Math.floor((idle % 60000) / 1000) })
        const parts = [h('span', { key: 'phase', className: 'dshST_livePhase' }, phaseText)]
        if (settings.showElapsed) {
          parts.push(h('span', { key: 'sep1', className: 'dshST_liveSep' }, '·'))
          parts.push(h('span', { key: 'time', className: 'dshST_liveTime' }, elapsed))
        }
        if (settings.showActivity) {
          parts.push(h('span', { key: 'sep2', className: 'dshST_liveSep' }, '·'))
          parts.push(h('span', { key: 'activity', className: 'dshST_liveActivity' }, activityText))
        }
        capsule = h('span', {
          className: 'dshST_live',
          'data-stalled': stalled ? '' : undefined,
          role: 'status',
          'aria-live': 'off',
          'aria-label': [phaseText, settings.showElapsed ? elapsed : null, settings.showActivity ? activityText : null]
            .filter((part) => part !== null).join(', '),
        },
          h('span', { className: 'dshST_liveDot', 'aria-hidden': true }),
          parts)
      }

      return h('div', { className: 'dshST_root', 'data-dsh-step-panel': '' },
        h('div', { className: 'dshST_card', role: 'status', 'aria-live': 'off' },
          h('div', { className: 'dshST_head' },
            h('span', { className: 'dshST_title' }, t('step.title')),
            capsule,
            projected.hidden > 0
              ? h('span', { className: 'dshST_more' }, t('step.earlier', { n: projected.hidden }))
              : null),
          h('div', { className: 'dshST_rows' }, rows)))
    }

    /* ------------------------------------------------------------------ *
     * Reasoning machine translation
     *
     * The body slot wrapper renders the original or the translated Markdown
     * through Chat's own `conversation.chat.reasoning.content` Factory, so
     * typography, code blocks and the streaming caret stay Chat-owned. Only
     * complete paragraphs (or a bounded prefix of a long paragraph) are sent;
     * the unfinished tail always stays original. The view toggle is local and
     * never remounts the disclosure, so expanded state and streaming survive.
     * ------------------------------------------------------------------ */

    /** Reject after the Host route's timeout; the route also aborts server-side. */
    function translationTimeout(ms) {
      const controller = new AbortController()
      const timer = window.setTimeout(() => controller.abort(new Error('translation-timeout')), ms)
      return { signal: controller.signal, cancel: () => window.clearTimeout(timer) }
    }

    /**
     * Length of the prefix that is safe to translate.
     *
     * Prefer the last completed paragraph; without one, a completed line; for
     * a long single paragraph, a bounded chunk cut at whitespace. The remaining
     * tail stays original so streaming never waits on the translator.
     * @param {string} text - current reasoning text.
     * @param {number} cursor - already translated source length.
     * @param {number} maxChars - request limit.
     * @returns {number} end offset of the translatable prefix.
     */
    function stablePrefix(text, cursor, maxChars) {
      const remaining = text.slice(cursor)
      const paragraph = remaining.lastIndexOf('\n\n')
      if (paragraph >= 0) return cursor + paragraph + 2
      const newline = remaining.lastIndexOf('\n')
      if (newline > 0) return cursor + newline + 1
      if (remaining.length >= maxChars) {
        let cut = Math.max(1, Math.min(maxChars, remaining.length))
        const space = remaining.lastIndexOf(' ', cut)
        if (space > cut / 2) cut = space
        return cursor + cut
      }
      return cursor
    }

    /** Request one fragment; resolve to the text or throw a classified error. */
    async function requestTranslation(fragment, options) {
      if (typeof fetch !== 'function') throw new Error('no-fetch')
      const timeout = translationTimeout(options.timeoutMs)
      const signal = options.signal === undefined
        ? timeout.signal
        : (typeof AbortSignal.any === 'function'
          ? AbortSignal.any([options.signal, timeout.signal])
          : options.signal)
      try {
        const response = await fetch('./api/stream-polish/translate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          signal,
          body: JSON.stringify({
            text: fragment,
            provider: options.provider,
            targetLanguage: options.targetLanguage,
            sessionId: options.sessionId,
          }),
        })
        if (!response.ok) throw new Error('http-' + response.status)
        const result = await response.json()
        if (result?.ok !== true) throw new Error(String(result?.code ?? 'failed'))
        return String(result.text ?? '')
      } finally {
        timeout.cancel()
      }
    }

    /** Reasoning body wrapper: translated view, original view, and retry. */
    function TranslationBody(props) {
      const settings = useSettings()
      const t = typeof props.t === 'function' ? props.t : translate
      const source = typeof props.text === 'string'
        ? props.text
        : (typeof props.rawText === 'string' ? props.rawText : '')
      const running = props.running === true
      const sessionId = typeof props.sessionId === 'string' ? props.sessionId : undefined
      const [capability, setCapability] = React.useState(() => readCapabilities().translation)
      const [showOriginal, setShowOriginal] = React.useState(false)
      const [version, setVersion] = React.useState(0)
      const [translation, setTranslation] = React.useState({
        text: '', cursor: 0, pending: false, failed: false, code: null,
      })
      const translationRef = React.useRef(translation)
      const sourceRef = React.useRef(source)
      const prevSourceRef = React.useRef(source)
      const configRef = React.useRef({
        provider: settings.translationProvider,
        targetLanguage: resolveTargetLanguage(settings.translationTargetLanguage),
        timeoutMs: settings.translationTimeoutMs,
        sessionId,
        maxChars: capability.maxTextChars ?? 4000,
        enabled: settings.translation && settings.enabled,
        available: capability.available,
      })
      const abortRef = React.useRef(null)
      const timerRef = React.useRef(0)
      const inflightRef = React.useRef(false)

      translationRef.current = translation
      sourceRef.current = source
      configRef.current = {
        provider: settings.translationProvider,
        targetLanguage: resolveTargetLanguage(settings.translationTargetLanguage),
        timeoutMs: settings.translationTimeoutMs,
        sessionId,
        maxChars: capability.maxTextChars ?? 4000,
        enabled: settings.translation && settings.enabled,
        available: capability.available,
      }

      /** Ask the Host capability route once per mount; the wire fallback still works. */
      React.useEffect(() => {
        let alive = true
        apiCall('/translation').then((result) => {
          if (!alive || result?.ok !== true) return
          setCapability({
            available: result.available === true,
            maxTextChars: Number.isInteger(result.maxTextChars) ? result.maxTextChars : null,
          })
        })
        return () => { alive = false }
      }, [])

      /** Translate as much of the stable prefix as currently exists. */
      const pump = React.useCallback(() => {
        if (inflightRef.current) return
        const config = configRef.current
        if (!config.enabled || !config.available) return
        const text = sourceRef.current
        if (text.trim() === '') return
        const state = translationRef.current
        const end = stablePrefix(text, state.cursor, config.maxChars)
        if (end <= state.cursor) return
        const chunk = text.slice(state.cursor, Math.min(end, state.cursor + config.maxChars))
        const nextCursor = state.cursor + chunk.length
        inflightRef.current = true
        const controller = new AbortController()
        abortRef.current = controller
        const started = { ...state, pending: true, failed: false, code: null }
        translationRef.current = started
        setTranslation(started)
        requestTranslation(chunk, { ...config, signal: controller.signal })
          .then((translated) => {
            if (controller.signal.aborted) return
            const current = translationRef.current
            const next = {
              text: current.text + translated,
              cursor: Math.max(current.cursor, nextCursor),
              pending: false,
              failed: false,
              code: null,
            }
            translationRef.current = next
            setTranslation(next)
            // Release the in-flight gate before chaining the next stable
            // fragment; `.finally` alone would run after this callback.
            inflightRef.current = false
            abortRef.current = null
            pump()
          })
          .catch((error) => {
            if (controller.signal.aborted) return
            const next = {
              ...translationRef.current,
              pending: false,
              failed: true,
              code: error instanceof Error ? error.message : String(error),
            }
            translationRef.current = next
            setTranslation(next)
          })
          .finally(() => {
            if (abortRef.current === controller) abortRef.current = null
            inflightRef.current = false
          })
      }, [])

      /** Debounced pump: streaming appends schedule work; a reset restarts it. */
      React.useEffect(() => {
        if (!settings.enabled || !settings.translation) return undefined
        const previous = prevSourceRef.current
        prevSourceRef.current = source
        if (previous !== '' && !source.startsWith(previous)) {
          // The reasoning text was replaced or shrank: drop translated segments
          // instead of stitching a translation of a different source.
          abortRef.current?.abort()
          abortRef.current = null
          inflightRef.current = false
          const reset = { text: '', cursor: 0, pending: false, failed: false, code: null }
          translationRef.current = reset
          setTranslation(reset)
        }
        // Keep one pending debounce across token appends: resetting the timer
        // on every delta would starve translation during a continuous stream.
        if (timerRef.current !== 0) return undefined
        timerRef.current = window.setTimeout(() => {
          timerRef.current = 0
          pump()
        }, 220)
        return undefined
      }, [source, settings.enabled, settings.translation, settings.translationProvider,
        settings.translationTargetLanguage, capability.available, capability.maxTextChars, version, pump])

      /** Language, provider, or enable changes restart from the current source. */
      React.useEffect(() => {
        abortRef.current?.abort()
        abortRef.current = null
        inflightRef.current = false
        window.clearTimeout(timerRef.current)
        timerRef.current = 0
        const reset = { text: '', cursor: 0, pending: false, failed: false, code: null }
        translationRef.current = reset
        setTranslation(reset)
        setVersion((value) => value + 1)
      }, [settings.translationProvider, settings.translationTargetLanguage])

      /** Unmount (collapse, session switch, plugin unload) cancels the request. */
      React.useEffect(() => () => {
        abortRef.current?.abort()
        abortRef.current = null
        window.clearTimeout(timerRef.current)
      }, [])

      const available = capability.available
      const failed = translation.failed
      const pending = translation.pending
      const displayed = !available || failed || showOriginal
        ? source
        : translation.text + source.slice(translation.cursor)
      const labels = React.useMemo(() => ({
        code: {
          copyLabel: t('copy'),
          copiedLabel: t('copied'),
          toolbarLabels: {
            codeLabel: t('codeTitle'),
            wrapLabel: t('wrap'),
            unwrapLabel: t('unwrap'),
          },
        },
        footnotes: t('footnotes'),
      }), [t])

      const retry = () => {
        const reset = { ...translationRef.current, failed: false, code: null }
        translationRef.current = reset
        setTranslation(reset)
        setVersion((value) => value + 1)
      }

      return h('div', {
        className: 'dshTR_root',
        'data-dsh-reasoning-translation': '',
        'data-view': showOriginal ? 'original' : 'translated',
        'data-state': !available ? 'unavailable' : failed ? 'failed' : pending ? 'pending' : 'ready',
      },
        h('div', { className: 'dshTR_bar' },
          available
            ? h('button', {
              type: 'button',
              className: 'dshTR_toggle',
              disabled: failed,
              'aria-pressed': showOriginal ? 'true' : 'false',
              onClick: () => setShowOriginal((value) => !value),
            }, t(showOriginal || failed ? 'translate.viewTranslation' : 'translate.viewOriginal'))
            : h('span', { className: 'dshTR_note' }, t('translate.unavailable')),
          pending ? h('span', { className: 'dshTR_note' }, t('translate.translating')) : null,
          failed ? h('span', { className: 'dshTR_note' }, t('translate.failed')) : null,
          failed ? h('button', {
            type: 'button',
            className: 'dshTR_toggle',
            onClick: retry,
          }, t('translate.retry')) : null),
        props.renderFactorySlot('conversation.chat.reasoning.content', {
          text: displayed,
          running,
          labels,
        }))
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

      const readLocale = () => {
        try {
          uiLocale = ctx.locale.getSnapshot?.().active ?? 'en'
        } catch {
          uiLocale = 'en'
        }
      }
      readLocale()
      if (typeof ctx.locale.subscribe === 'function') {
        ctx.effect(() => ctx.locale.subscribe(readLocale), 'stream-polish: locale sync')
      }

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

      ctx.slots.inject('conversation.input.dock', () => [
        ctx.slots.register({
          name: 'conversation.input.dock',
          id: 'run-strip',
          order: 0,
          locale: NS,
        }, RunStrip),
        ctx.slots.register({
          name: 'conversation.input.dock',
          id: 'step-panel',
          order: 1,
          locale: NS,
        }, StepPanel),
      ])

      // The single reasoning Body cell is intentionally shadowed only while
      // translation is enabled: priority -1 beats Chat's built-in body (0) and
      // the optional cot-translation bundle's wrapper. Turning the switch off
      // withdraws this entry, so the built-in body renders again unchanged.
      ctx.slots.inject('conversation.chat.reasoning.body', () => {
        let active = null
        const sync = () => {
          // Without the Host-published translator capability, keep Chat's own
          // body: a wrapper that can only show the original is pure noise.
          const wanted = store.get().enabled && store.get().translation
            && readCapabilities().translation.available
          if (wanted && active === null) {
            active = ctx.slots.register({
              name: 'conversation.chat.reasoning.body',
              priority: -1,
              locale: NS,
            }, TranslationBody)
          } else if (!wanted && active !== null) {
            active()
            active = null
          }
        }
        sync()
        const unsubscribe = store.subscribe(sync)
        return () => {
          unsubscribe()
          if (active !== null) {
            active()
            active = null
          }
        }
      })

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
