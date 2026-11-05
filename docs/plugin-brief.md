# DSH 插件 brief：`@local/stream-polish` 思考翻译 + 本轮步骤面板

> 版本：1.3.0 · 目标 DSH 约定：Loader bundle、`dsh.client` 浏览器半、Slot 组合、`connection.fetch.register`、可选 `translator` 服务
> 本文只写已经在本仓库源码和 DSH 源码中核对的契约；无法从现有约定确认的部署细节用 `[方括号]` 标出。

## 一、实现方案摘要

在现有 `@local/stream-polish` 上做两块纯展示增量，不修改 Agent 循环、不写 Session、不接管滚动：

1. **思考翻译（Client + Host 双端）**
   - Client 半注册 `conversation.chat.reasoning.body`（single slot，`priority: -1`），只在 `translation: true` 且 Host 发布 `capabilities.translation.available` 时遮蔽内建 body。
   - 翻译视图与原文视图复用 Chat 自己的 `conversation.chat.reasoning.content` Factory，只替换传入文本；工具栏固定为“查看原文 / 查看译文”，展开状态、滚动位置和流式光标仍由 Chat 持有。
   - Host 半新增两个认证路由：`GET /api/stream-polish/translation` 返回能力与请求上限，`POST /api/stream-polish/translate` 校验入参后调用可选的 `ctx.translator.resolve()` / `translate()`。失败只返回稳定错误码，不回显原文或 provider 响应体。
   - 只翻译“稳定前缀”：完整段落优先，其次完整行，单段过长时按 `maxTextChars` 切块；未完成的尾部保持原文。已译片段按游标累积，流式 token 不会重发整段。
   - 目标语言**由用户配置**，落在 `translationTargetLanguage`，默认 `zh-CN`；接受 `auto`（跟随界面语言）或 `zh-CN` / `en` / `ja` 等标签。

2. **本轮步骤面板（Client 单端）**
   - 在 `conversation.input.dock` 增加 `id: step-panel` 的列表项，按 composer stack 的正常文档流排在输入框上方；面板占据真实高度、把正文推上去，不覆盖最后一张工具卡。列表自身限高滚动。
   - 运行胶囊开启时，阶段/时长/活动移入面板标题栏；独立的 `.dshRS_root` 在面板可见期间隐藏。
   - 通过 session 作用域的标准 prop `useChat` 读取 `ChatSnapshot`：`timeline.turnOrder` 取最新一轮，`timeline.turns` 取 step 起点，`legacy.nodes` 取已落定的 Assistant / Tool-result，`legacy.runningCalls` 与 `legacy.partial` 取进行中的工具和思考。
   - 每条一行：动作（工具名或“思考/回复”）、对象（`command`/`file_path`/`pattern`/`query`/`url`/`description` 中最具体的一项，或首个非空行）、状态（`running`/`pending`/`done`/`error`）、用时（tool 为 `time - callTime`，运行中按秒累加；assistant 为 `completedTime - stepStartTime`）。
   - 只渲染 `stepPanelRows` 条，更早的折成“更早 N 条”；运行中的用时每秒 tick 一次，其他时刻不重建列表。本轮结束后保留 8 秒再收起。

3. **可配置项**
   - 新增 9 个配置项（见第四节），全部走现有四层优先级：内置默认 < 包内 `cordis.patch.yml` < 档案 patch < 本浏览器 `localStorage` 覆盖。
   - `index-inject` wire 从 v2 升到 v3，新增 `capabilities.translation`；旧 Client 会忽略不认识的 payload，继续用内置默认。

## 二、插件契约

### 2.1 包名与入口点

| 项 | 值 |
| --- | --- |
| 包名 | `@local/stream-polish` |
| Host 入口 | `index.js`（`exports["."]`） |
| 浏览器入口 | `client.js`（`exports["./client"]`，`dsh.client.platform: "web"`，`immediately: true`） |
| 配置契约入口 | `config.js`（`exports["./config"]`） |
| 其他导出 | `locale/*.json`、`icon.svg` |
| 构建 | 无构建步骤；Host/Client 都是可直接加载的 ESM / 普通脚本（Client 由 `window.__ModuleLoader__.load({ id, factory })` 注册） |

### 2.2 运行位置：双端

| 半边 | 职责 | 生命周期 | 通信 |
| --- | --- | --- | --- |
| Host（`index.js`） | 校验 Loader 行配置；按 `logLevel` 报告非法值；在每次 `webserver/index-inject` 下发配置与能力快照；注册认证路由；按需读取可选 `translator` 服务；升级后用 `hmr.reconcileProfile([ROW_ID])` 重载自身 | Loader 行激活到停用；路由随 `connection` 作用域 effect 注册/撤销 | `webserver/index-inject` 下发 `globalThis.__DSH_STREAM_POLISH__`；浏览器通过同源 `/api/stream-polish/*` 调用 |
| Browser（`client.js`） | 解析四层配置；生成样式表；挂 settling/运行观察器；运行胶囊；步骤面板；思考翻译 body；设置页 | 插件 `apply(ctx)` 到 `ctx.effect` 清理；Slot 贡献随声明生命周期注册/撤销 | 读取 `globalThis.__DSH_STREAM_POLISH__`；`fetch('./api/stream-polish/...')`（`credentials: 'same-origin'`）；Slot props / 标准 props 读取 Chat 数据 |

不引入 typert Remote、不新增 WebSocket、不新增后台定时任务。

### 2.3 Loader 行 id 与 cordis 补丁

- **Loader 行 id**：`stream-polish`（`index.js` 的 `ROW_ID`，也是升级后 `hmr.reconcileProfile` 传入的 id）。
- **cordis 补丁**：`stream-polish/cordis.patch.yml`，由 `package.json` 的 `dsh.bundle.patch: "./cordis.patch.yml"` 声明；补丁内容为 `- insert:` 下一行：

```yaml
- insert:
    - id: stream-polish
      name: '@local/stream-polish'
      config:
        enabled: true
        # ... 省略的既有默认值 ...
        stepPanel: true    # 与 stream-aura 的步骤清单同位置；二选一或把 stream-aura 切单行
        stepPanelRows: 5
        stepPanelAccent: '#4f8cff'
        stepPanelMotion: true
        stepPanelPhaseColors: true
        translation: false
        translationProvider: bing
        translationTargetLanguage: zh-CN
        translationTimeoutMs: 8000
```

- 档案覆盖：`$DSH_PROFILE_DIR/cordis.patch.yml` 里同 id `stream-polish` 的 `config` 段（本机为 `/home/pro/.dsh-src/profiles/web/cordis.patch.yml`）。

### 2.4 注入的服务

| 半边 | 服务 | 用途 | 注入方式 |
| --- | --- | --- | --- |
| Host | `connection` | 注册 `/api/stream-polish/*` 认证路由（已有升级路由与新增翻译路由） | `ctx.inject(['connection'], …)` |
| Host | `translator`（**可选**） | 唯一的机器翻译执行者；提供 `resolve()`、`translate()`、`maxTextChars`、`availableProviders()` | 不强制注入；每次请求 `ctx.get('translator')` 读取，缺失即返回 `UNAVAILABLE` |
| Host | `hmr`（可选） | 在线升级后重载 Host 模块 | `ctx.get('hmr')`，缺失则返回 `restart-required` |
| Browser | `slots` | 注册输入区/思考区/设置页贡献 | `export inject = ['slots', 'locale']` |
| Browser | `locale` | 注册 `streamPolish` 词典并提供 `t` | 同上 |
| Browser | 标准 props `useChat` | 步骤面板读取 `ChatSnapshot` | `conversation.input.dock` 的 `session` scope 由 `ui-chat` 提供，无需自行注入服务 |
| Browser | 标准 props `session` / `sessionId` | 判断运行中、绑定翻译请求的 Session | `session` scope owner props |

`package.json` 的 `dsh.client.inject` 只声明客户端包依赖顺序：`@deepseek-ai/dsh-client-ui-chat`、`@deepseek-ai/dsh-client-ui-conversation`、`@deepseek-ai/dsh-client-ui-plugin-manager`。

### 2.5 注册的 tool / route / slot

#### Tool

无。本插件不注册任何模型可调用工具。

#### Route（`connection.fetch.register`，均要求已认证浏览器 Peer）

| 路径 | 方法 | 载荷 | 返回 |
| --- | --- | --- | --- |
| `/api/stream-polish/info` | GET | 无 | 插件版本、提交、包名 |
| `/api/stream-polish/update` | GET | 无 | `{ ok, available, behind, version, latestVersion, … }` |
| `/api/stream-polish/update/apply` | POST | `{}` | `{ ok, changed, from, to, reload }`；失败为结构化原因 |
| `/api/stream-polish/translation` | GET | 无 | `{ ok: true, available, maxTextChars, providers, defaultProvider, defaultTargetLanguage, timeoutMs }` |
| `/api/stream-polish/translate` | POST | `{ text, targetLanguage?, provider?, sessionId? }` | 成功 `{ ok: true, text }`；失败 `{ ok: false, code, retryable }` |

`translate` 的校验：`text` 必须是非空字符串且长度 ≤ `translator.maxTextChars`（服务缺失时回退 4000）；`provider` ∈ `bing|google`；`targetLanguage` 匹配 `/^(?:auto|[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*)$/`；`sessionId` 匹配 `/^[A-Za-z0-9._:-]{1,200}$/`。错误码：`BAD_REQUEST`、`TEXT_LIMIT`、`BAD_PROVIDER`、`BAD_LANGUAGE`、`BAD_SESSION`、`UNAVAILABLE`、`TIMEOUT`、`SESSION_INACTIVE`、`SESSION_REQUIRED`、`PROVIDER_FAILED`、`INVALID_RESPONSE`、`RESPONSE_LIMIT`、`REQUEST_FAILED`、`STORAGE_FAILED`、`FAILED`。所有错误响应只含 code，不回显提交文本或 provider 响应体。

#### Slot

| Slot | cardinality / scope | 注册内容 | 渲染位置 / 行为 |
| --- | --- | --- | --- |
| `conversation.input.dock` | list / session | `id: run-strip`，`order: 0` | composer 上方的运行胶囊（既有） |
| `conversation.input.dock` | list / session | `id: step-panel`，`order: 1` | composer 上方的本轮步骤面板；`stepPanel: false` 时返回 null |
| `conversation.chat.reasoning.body` | single / session | 条件注册，`priority: -1`，`locale: 'streamPolish'` | 展开的思考 body；渲染 Chat 的 `conversation.chat.reasoning.content` Factory，附“查看原文 / 查看译文”、翻译中/失败状态与重试 |
| `plugins.bundle.config` | keyed / root，`key: '@local/stream-polish'` | 设置页 | 设置 › 插件 › 已安装插件 › 流式输出美化 |

`conversation.chat.reasoning.body` 是 single cell：`priority` 越低越优先，默认 `0`。本插件只在翻译开启且能力可用时注册 `-1`，关闭开关即撤回，内建 body 原样回来。若档案同时启用官方 `cot-translation` 组合包，它同样使用 `translator` 服务和该 single slot；两者请二选一，避免同一位置出现两套翻译工具栏。

### 2.6 配置 schema 与默认值

`config.js` 的 `SPEC` 是唯一真源；`client.js` 中有逐字段镜像，`test/client.test.mjs` 断言两者（含正则）完全一致。类型为 `boolean | integer | enum | string`；`string` 带 `pattern`。

| 字段 | 类型 | 默认值 | 取值范围 / 校验 | 作用 |
| --- | --- | --- | --- | --- |
| `enabled` | boolean | `true` | `true/false` | 总开关；false 时不挂样式、观察器、胶囊与面板（设置页保留） |
| `blockFade` | boolean | `true` | `true/false` | 流式新块淡入 |
| `blockFadeMs` | integer | `160` | 80–600 | 块淡入时长 |
| `caret` | boolean | `true` | `true/false` | 呼吸光标 |
| `caretPeriodMs` | integer | `1200` | 400–4000 | 光标呼吸周期 |
| `settleFade` | boolean | `true` | `true/false` | 落定淡出 |
| `settleMs` | integer | `260` | 100–1000 | 落定淡出时长 |
| `stallMs` | integer | `15000` | 500–600000 | 停滞判定阈值 |
| `runStrip` | boolean | `true` | `true/false` | 运行胶囊 |
| `showElapsed` | boolean | `true` | `true/false` | 胶囊显示已用时长 |
| `showActivity` | boolean | `true` | `true/false` | 胶囊显示最近活动 |
| `stepPanel` | boolean | `true`（本档案同位置还有 `stream-aura`，二者请二选一） | `true/false` | **本轮步骤面板** |
| `stepPanelRows` | integer | `5` | **1–20** | **可见步骤数**；超出部分折成“更早 N 条” |
| `stepPanelAccent` | string | `'#4f8cff'` | `/^#[0-9a-fA-F]{6}$/` | **强调色** |
| `stepPanelMotion` | boolean | `true` | `true/false` | **动效**（160ms 淡入 + 3px 上移；`prefers-reduced-motion` 自动关） |
| `stepPanelPhaseColors` | boolean | `true` | `true/false` | **阶段着色**（思考中性、工具强调、失败红、完成绿） |
| `replaceToolRows` | boolean | `false`（本档案 patch 置 `true`） | `true/false` | 面板可见时隐藏正文里的原生工具行；关闭即恢复 |
| `toolCardPolish` | boolean | `true` | `true/false` | 原生工具行圆角/内描边/悬停/状态色，纯绘制不改布局 |
| `translation` | boolean | `false` | `true/false` | **是否启用思考翻译**（默认关闭：会外发内容） |
| `translationProvider` | enum | `'bing'` | `bing \| google` | 翻译服务（匿名端点） |
| `translationTargetLanguage` | string | `'zh-CN'` | `/^(?:auto\|[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*)$/` | **目标语言**；`auto` 跟随界面语言 |
| `translationTimeoutMs` | integer | `8000` | 1000–30000 | 单次翻译超时 |
| `logLevel` | enum | `'warn'` | `silent \| error \| warn \| info \| debug` | 本插件日志级别 |

非法值行为：保留默认值，并按 `logLevel` 输出一条命名该键、期望值、实际值、回落值的消息；未知键报告后忽略；非 mapping 的 config 整体回落默认值。任何情况下不抛错、不白屏。

### 2.7 失败行为

| 场景 | Host | Browser | 是否阻塞智能体输出 |
| --- | --- | --- | --- |
| `translator` 未挂载 | `GET /translation` 返回 `available: false`；`POST /translate` 返回 `UNAVAILABLE` | 不注册思考 body 包装，Chat 内建 body 原样显示；设置页提示“本部署没有挂载 translator 服务” | 否 |
| 翻译超时 | `AbortSignal.timeout(translationTimeoutMs)`；返回 `TIMEOUT` | 浏览器侧同样有超时；保留原文，显示“翻译暂不可用，已显示原文”+ 重试 | 否 |
| 限流 / HTTP 失败 / 无效响应 | 返回 `PROVIDER_FAILED` / `INVALID_RESPONSE` / `RESPONSE_LIMIT`，不重试、不换 provider | 保留原文 + 手动重试；不自动重试，避免放大限流 | 否 |
| 文本超限 | 返回 `TEXT_LIMIT`（带 `maxTextChars`），不派发 | 浏览器按 `maxTextChars` 切块，单块绝不会超限 | 否 |
| Session 未激活 | 返回 `SESSION_INACTIVE` | 保留原文 + 重试；不阻塞流式 | 否 |
| 路由缺失（旧 Host / 404） | — | 能力探测失败，按不可用处理；原文照常显示 | 否 |
| 思考折叠 / 切换 provider / 语言 / 卸载 | 请求被 abort | 取消未完成请求，忽略迟到结果；展开状态不丢 | 否 |
| 步骤数据缺失（空白会话 / 窗口未加载） | — | 面板返回 null，不占位、不报错 | 否 |
| 流式中断 / turn 异常结束 | — | 面板继续显示最后一次快照；运行中的行保留 `running`，直到 Chat 快照把它们落定或会话停止；不会伪造完成 | 否 |
| 步骤面板配置为 `false` | — | 组件返回 null；运行胶囊不受影响 | 否 |

原则：UI 只读 Chat 公开快照，翻译是异步、可取消的旁路请求；任何失败都不改变 Session 事件、模型输入或正文渲染。

### 2.8 验证步骤

**构建 / 静态检查**

```bash
cd /home/pro/dsh/stream-polish
npm run lint          # node --check 五个源文件
npm test              # 71 条：config/client/host/routes/update/browser
```

`test/browser.test.mjs` 用本机 Chromium 通过 CDP 验证计算样式和 Slot 挂载数量；找不到 Chromium 时自动跳过，可设 `CHROME_PATH`。

**加载插件**

- 本机档案已通过 `link:/home/pro/dsh/stream-polish` 安装，并在 `dsh.profile.bundles` 中包含 `@local/stream-polish`。
- 新档案：在 `package.json` 依赖加 `"@local/stream-polish": "link:/home/pro/dsh/stream-polish"`，并在 `dsh.profile.bundles` 加入同名条目，然后 `pnpm install`。

**是否需要重启 DSH**

- 改 `client.js` / `locale/*` / `cordis.patch.yml`：刷新页面即可（Client Modules 按 bundle revision 重新对账）。
- 改 `index.js` / `config.js` / `lib/routes.js`（wire v3、翻译路由、`capabilities`）：**需要重启 Host**，或走插件自带的 `/api/stream-polish/update/apply` 触发 `hmr.reconcileProfile`。本机重启方式：`[systemctl restart dsh-web-src（按实际部署填写）]`。
- 重启/重载后复查：页面无 console error；`window.__DSH_STREAM_POLISH__.version === 3`；`capabilities.translation.available` 与 `translator` 实际挂载一致；`GET /api/stream-polish/translation` 返回 200；思考 body 的工具栏只在 `translation: true` 时出现。

**触发思考与工具调用**

1. 发送一条需要多步工具调用的请求（例如“读 README 并总结，再跑测试”）。
2. 观察 composer 上方：运行胶囊显示阶段/时长/活动；步骤面板逐条出现“思考 / 运行命令 / 读取文件…”行，状态从 `running` 变 `done`，用时随完成落定。
3. 打开一条“思考”行，确认工具栏出现“查看原文”；翻译完成后正文变为目标语言。

**验证译文与“查看原文”切换**

- 点击“查看原文”：正文回到原文，思考行仍保持展开；再次点击“查看译文”回到译文。
- 在翻译进行中切换视图：流式 token 继续追加，展开状态和滚动位置不变；返回译文后已译部分仍在。
- 断网/限流（或把 `translationProvider` 指向不可达端点）：正文保留原文，显示失败提示与“重试”；智能体正文继续流式输出。
- 折叠思考再展开：未完成请求被取消；重新展开会从已保存/已译部分继续，不重复发送已完成片段。

**验证步骤面板字段与配置**

- `stepPanelRows: 2`：只显示最后 2 条，头部出现“更早 N 条”。
- `stepPanelAccent: '#ff6600'`：运行中工具圆点/状态文字变为该色（`stepPanelPhaseColors: true` 时）。
- `stepPanelMotion: false`：新增行不再播放 160ms 入场；系统减少动态效果时同样不播放。
- `stepPanelPhaseColors: false`：所有圆点退回中性色。
- `stepPanel: false`：面板消失，运行胶囊与正文不受影响。
- 空白会话：不渲染面板；首轮开始后出现。

**重启后复查**

- `translation: false` 时，`reasoning.body` 不注册包装，Chat 内建 body 无额外工具栏。
- `translation: true` 且 translator 可用时，body 注册为 `priority: -1`；关闭开关后内建 body 恢复。
- 升级路由仍可用（`GET /api/stream-polish/info` 200），且升级后 Host 能通过 HMR 重载。
- `npm test` 仍为 71 条全绿，`npm run lint` 通过。

## 三、需要补充/确认的信息

- `[部署重启方式：本机为 systemctl restart dsh-web-src，其他部署按实际进程管理方式填写]`
- `[档案名与 DSH_PROFILE_DIR：本机为 /home/pro/.dsh-src/profiles/web；其他部署按实际档案填写]`
- `[是否保留官方 cot-translation 组合包的思考 body：若保留，请只启用其中一套翻译 UI（single slot 只能有一个胜者）]`
- `[目标语言默认值是否符合团队约定：当前为 zh-CN；如需跟随界面语言可改为 auto]`
