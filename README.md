# 流式输出美化（Stream polish）

给 Agent 输出的两个阶段各加一层克制的观感：

- **流式时**：新段落柔和淡入，正在写的段落末尾有一枚呼吸光标，回复落定时光标淡出。
- **等待时**：输入框上方浮出一枚运行胶囊，显示当前阶段、已用时长和最近活动；超过 15 秒没有新输出时变成琥珀色的「无新输出」。

样式和观察器都在 Client 半，不改渲染逻辑、不改会话数据、不读模型输出。滚动跟随和「回到最新」仍由 Chat 自己负责，这个插件没有重复实现。

## 流式时

![streaming → settling → settled](docs/caret-settle-sequence.png)

![落定淡出（动态）](docs/caret-fade.gif)

- **块级淡入**：流式过程中新挂载的段落、标题、列表项、代码块、引用和表格，做 160ms 的 `opacity 0→1` + `translateY(4px)→0`。已经在屏幕上的块不会因为后续 token 重播动画。
- **呼吸光标**：最后一层文本块末尾显示 2px 圆角竖线，1.2s 呼吸一次，底部渐隐。
- **落定淡出**：`data-streaming` 被移除时，给根节点加 340ms 的 `data-dsh-sp-settling`，光标在 260ms 内淡到 0，而不是一帧消失。
- **不重排**：光标用负右边距抵消自身宽度；实测落定前后最后一个字符的 `x/y/width`、段落高度和宽度全部为 0 位移。
- **降级**：`prefers-reduced-motion: reduce` 下关闭淡入、呼吸和落定淡出；`forced-colors: active` 下用 `CanvasText` 绘制。

## 等待时

![running → stalled](docs/runstrip-states.png)

运行胶囊挂在 `conversation.input.dock`，绝对定位在 composer 上方，因此出现和消失都不会改变输入框高度或推动正文。它显示：

- **阶段**：`Thinking`（没有工具、没有正文流）、`Running Bash` / `Running Read`（当前运行的命令或工具）、`Writing reply`（正文在流）。
- **已用时长**：当前阶段从开始到现在的 mm:ss。
- **最近活动**：最后一次正文 token、工具输出或状态变化距今多久。
- **停滞提示**：15 秒没有新输出后，圆点和活动文案变成琥珀色，显示 `no new output for 19s`；不会直接判死，也不会伪造百分比进度。

阶段判定方式：

- `[data-chat-flow]` 里出现带 `data-shimmer` 的运行行时，取最后一个可见运行行的首行作为工具名（`Bash`、`Read`、`Write`…）；`Running commands` 统一显示为 `Running commands`。
- 没有运行行时，`[data-streaming]` 存在即为 `Writing reply`，否则为 `Thinking`。
- `[data-chat-running]` 里的总时长文字、`[data-shimmer]` 里的计时、纯 `12s` / `1m 5s` 文本都不算“新输出”，否则停滞检测永远不会触发。

## 配置

行为全部由一个配置对象决定，默认值就是 1.0.0 的行为：不配置任何东西，观感与之前完全一致。改配置不需要改源码，刷新页面即生效。

加载优先级（低 → 高）：

| 优先级 | 来源 | 位置 |
| --- | --- | --- |
| 1 | 内置默认值 | `config.js` 的 `SPEC`，与 1.0.0 完全一致 |
| 2 | 包自带 patch | 本包 `cordis.patch.yml` 中 `stream-polish` 行的 `config` |
| 3 | 档案 patch 覆盖 | `$DSH_PROFILE_DIR/cordis.patch.yml` 中同 id 的 `config` 段 |
| 4 | 浏览器本地覆盖 | `localStorage` 键 `dsh.stream-polish.settings`（调参、临时调试） |
| 5 | 测试钩子 | `window.__DSH_SP_STALL_MS__`，仅覆盖 `stallMs` |

Host 半在行激活时用 `config.js` 校验一次：合法值随 `webserver/index-inject` 下发给 Client 半，非法值在 Host 控制台报一条消息并回落到默认值，不会抛错、不会让页面变白。Client 半再叠加第 4、5 层，并用同一张表校验浏览器本地覆盖。

配置项（全部可选，未设置即取默认值）：

| 配置项 | 类型 | 默认值 | 取值范围 | 作用 | 必填 |
| --- | --- | --- | --- | --- | --- |
| `enabled` | boolean | true | true / false | 总开关；false 时不挂样式、观察器和运行胶囊 | 否 |
| `blockFade` | boolean | true | true / false | 流式期间新挂载的 Markdown 块是否做淡入 | 否 |
| `blockFadeMs` | number（整数） | 160 | 80–600 | 块淡入时长，毫秒 | 否 |
| `caret` | boolean | true | true / false | 正在书写的末尾是否显示呼吸光标 | 否 |
| `caretPeriodMs` | number（整数） | 1200 | 400–4000 | 光标一次呼吸的周期，毫秒 | 否 |
| `settleFade` | boolean | true | true / false | 落定时光标是否淡出；false 则直接消失 | 否 |
| `settleMs` | number（整数） | 260 | 100–1000 | 落定淡出时长，毫秒；清理定时器取该值加 80ms | 否 |
| `stallMs` | number（整数） | 15000 | 500–600000 | 多久没有新输出就显示「无新输出」，毫秒 | 否 |
| `runStrip` | boolean | true | true / false | 输入框上方是否显示运行胶囊 | 否 |
| `showElapsed` | boolean | true | true / false | 胶囊是否显示当前阶段已用时长 | 否 |
| `showActivity` | boolean | true | true / false | 胶囊是否显示最近活动 / 停滞文案 | 否 |
| `logLevel` | enum | warn | silent, error, warn, info, debug | 本插件日志级别 | 否 |

`logLevel` 只影响本插件自己的输出：`silent` 全静音；`error` 只报错误；`warn`（默认）在配置有误时告警，合法配置下完全静默；`info` 额外报告一次「configuration accepted」；`debug` 再打印解析后的完整配置对象。

示例——包自带 patch 或档案 patch 里都可以这样写：

```yaml
- id: stream-polish
  config:
    stallMs: 8000        # 8 秒没有新输出就提示
    caretPeriodMs: 1600  # 光标呼吸慢一点
    showActivity: false  # 胶囊只留阶段和时长
```

临时调参（只影响当前浏览器，不改任何文件）：

```js
localStorage.setItem('dsh.stream-polish.settings', JSON.stringify({ caret: false }))
location.reload()
```

写错时的报错（配置项名 + 期望值 + 实际收到的值 + 回落到什么）：

```text
[@local/stream-polish] config.stallMs must be an integer between 500 and 600000; got 'fast'; using 15000.
[@local/stream-polish] config.logLevel must be one of "silent" | "error" | "warn" | "info" | "debug"; got 'verbose'; using 'warn'.
[@local/stream-polish] config.typoKey is not a recognized option (ignored).
```

配置项少于要求的粒度也没关系：`enabled: false` 只是不挂载任何界面，行仍留在 Loader 里，改回 `true` 刷新即可恢复。

## 设置页

插件在那里挂载后，**设置 › 插件 › 流式输出美化** 有一页自己的设置：

- **显示**：总开关、块淡入、呼吸光标、落定淡出、运行胶囊、胶囊里的已用时长和最近活动，七个开关。
- **时长**：块淡入、光标呼吸周期、落定淡出、停滞阈值，输入框按 `config.js` 的边界校验，越界只是标红并退回上一个合法值，不会写进配置。
- **诊断**：日志级别 `silent` / `error` / `warn` / `info` / `debug`。
- **预览**：页面顶部的迷你对话片段用当前配置实时重放——新段落按你填的毫秒数淡入、末尾光标按你设的周期呼吸、胶囊按开关显示阶段/时长/活动；改任意一项立刻看到差别，点「重播」再放一次。
- **恢复默认**：清掉本浏览器的覆盖值，回到档案里配置的默认值。

改动**立即生效**，不需要刷新：样式表按新配置重建，观察器按开关增删，胶囊的段落跟着 `showElapsed` / `showActivity` 变化。标题右侧出现「本浏览器已改动」的标记，表示当前值和档案默认值不同。

保存位置是 `localStorage` 的 `dsh.stream-polish.settings`，**只属于当前浏览器**；要改所有浏览器的默认值，仍然改档案里的 `cordis.patch.yml`（见上一节的优先级表）。

> 本档案里的 `cordis.patch.yml` 把 `runStrip` 关掉了：`stream-aura` 已经在同一个位置渲染运行卡片，两个胶囊会叠在一起。想要小胶囊时在设置页打开「运行胶囊」即可。

## 在线升级

设置页顶部是「在线升级」卡片：显示当前版本与提交、远端版本与提交，两个按钮——**检查更新**、**一键升级**。

升级走的就是这个仓库自己的 git 工作区（`link:` 安装，所以不需要包管理器）：

1. `git fetch --prune origin`，比较 `HEAD` 与上游分支，算出落后/领先多少提交；
2. 只做 `git merge --ff-only`，也就是**只快进，绝不改写历史**；
3. 升级后重新读 `package.json`，包名或 version 不对就 `git reset --hard` 回滚；
4. 成功时 Host 半调用 Loader 的 `hmr.reconcileProfile()`，把改动过的模块重新导入，所以新的 `index.js` 不用重启进程也生效；浏览器那半刷新页面即可。

安全边界：

| 情况 | 行为 |
| --- | --- |
| 工作区有未提交改动 | 拒绝，提示先提交或 stash，工作区不动 |
| 本地领先上游（有未推送提交） | 拒绝快进，提示先处理这些提交 |
| 上游包名变了 | 拒绝，避免装成另一个包 |
| 拉取或校验失败 | 自动 `reset --hard` 回到升级前的提交 |
| 不在 git 工作区 / 没有远端 / detached HEAD | 明确报错，不尝试任何写入 |
| Host 进程没有 HMR | 升级仍然完成，但会提示需要重启 `dsh` |

接口都在 `/api/stream-polish` 下，走 Connection 的 `/api` 通道，因此和设置页一样受登录 cookie 与浏览器信任检查保护：`GET /info`、`GET /update`、`POST /update/apply`。它们不接受任何用户输入（插件目录与远端在激活时就固定了），所以不存在路径注入面。

## 为什么能做到

`AssistantMarkdown` 在流式期间给根节点加 `data-streaming`，Markdown 的每个块都是这个根节点下的直接子元素。插件只用稳定属性和结构选择器，不依赖 `hWmORq_*`、`_markdown_*` 这类带 hash 的 CSS Module 类名。

Markdown 块的 React key 是**源码字符偏移**（例如 `0`、`57`、`566`），追加 token 不会改变已有块的 key，所以已有块不会重新挂载，也就不会反复淡入；只有新块拿到新 key 并播放一次动画。

光标只在文本块是 body 的最后一个子元素时出现。落定淡出时，选择器从 `[data-streaming]` 切换到 `[data-dsh-sp-settling]`：

```css
:is([data-streaming],[data-dsh-sp-settling]) > div > div:last-child
  > :is(p,h1,h2,h3,h4,h5,h6):last-child::after
:is([data-streaming],[data-dsh-sp-settling]) > div > div:last-child
  > :is(ul,ol):last-child > li:last-child::after
:is([data-streaming],[data-dsh-sp-settling]) > div > div:last-child
  > blockquote:last-child > p:last-child::after
```

`data-streaming` 消失时，`MutationObserver` 确认末尾仍有光标目标、加上 settling 属性、340ms 后移除。光标动画在 settling 期间换成 `dshSP_caretOut .26s ease-out forwards`。

运行胶囊另有一个 `MutationObserver`，只看 `[data-chat-flow]` 内的正文/工具变化；它忽略 `[data-chat-running]` 和 `[data-shimmer]`，避免总时长计时器把停滞状态刷掉。

## 文件

| 文件 | 作用 |
| --- | --- |
| `client.js` | Client 半：配置解析、样式表、settling 观察器、运行观察器、运行胶囊 |
| `index.js` | Host 半：校验行配置、按 `logLevel` 报告问题、下发 `__DSH_STREAM_POLISH__` |
| `config.js` | 配置契约：`SPEC`、默认值、校验与错误文案（Host 与文档共用） |
| `lib/update.js` | 在线升级：git 工作区定位、fetch / 状态比较、快进、回滚 |
| `lib/routes.js` | `/api/stream-polish` 的三个路由（info / update / update/apply） |
| `cordis.patch.yml` | 插入 `stream-polish` 行，并写出全部默认配置及取值范围 |
| `locale/zh.json`、`locale/en.json` | 插件管理页的标题与描述 |
| `icon.svg` | 原创图标 |
| `test/run.py` | 浏览器验收 harness（9 条断言，可覆盖 stall 阈值，需要 Playwright） |
| `test/config.test.mjs` | 配置契约测试：默认值、合法值、非法值、边界、文档覆盖 |
| `test/client.test.mjs` | Client 半测试：镜像一致性、优先级、错误文案、样式生成、挂载开关 |
| `docs/*.png`、`docs/*.gif` | 光标、落定序列、运行胶囊和插件页截图 |

## 安装

插件只有在档案的 `dsh.profile.bundles` 里才会挂载；只写 `dependencies` 不够。安装或换档案时：

```bash
# 在 agent 会话里
plugin_manager install_bundle target=link:/home/pro/dsh/stream-polish
```

或者手动把 `"@local/stream-polish": "link:/home/ubuntu/ctomall/stream-polish"` 加进档案的 `package.json` 依赖与 `dsh.profile.bundles`（缺任意一项都不会挂载），再 `pnpm install`。

安装后刷新一次页面；之后由 Client HMR 接管。

## 测试

两层，都不需要新依赖。

### 契约与单元测试（`node:test`）

```bash
cd stream-polish && npm test
```

- `test/config.test.mjs` 覆盖每个配置项的默认值、合法值、非法值和边界值（`min`/`max` 接受，`min-1`/`max+1` 拒绝），锁定「空配置 == 1.0.0 行为」，并检查 README 表格是否写全了所有配置项。
- `test/client.test.mjs` 在 `node:vm` 里加载 `client.js`，验证镜像表与 `config.js` 一致、四层优先级、错误文案与 Host 完全同文、样式表按配置生成、`enabled` / `caret` / `settleFade` / `runStrip` 的挂载开关，以及设置页写入后**立即重建**样式、按差量持久化、恢复默认。
- `test/host.test.mjs` 验证 `index.js` 的下发内容、`logLevel` 诊断门限和非法值回落。
- `test/browser.test.mjs` 用 Node 内置 WebSocket 走 CDP 驱动本机 Chromium，真开页面验证计算样式：默认 160ms / 1.2s / 0.26s、改配置后时长跟着变、`caret:false`、`enabled:false`、`runStrip:false`，以及 `prefers-reduced-motion` 降级。找不到 Chromium 时自动跳过，可用 `CHROME_PATH` 指定。

`npm run lint` 用 `node --check` 检查三个源文件的语法。

### 真实档案里的验收（需要 Playwright）

一条命令、一次页面加载、9 条断言，不读截图、不真等 15 秒：

```bash
python3 stream-polish/test/run.py --stall-ms 800
```

`--stall-ms` 会在页面脚本加载前写入 `window.__DSH_SP_STALL_MS__`，覆盖插件默认的 15000ms；默认值不变。需要最终截图时加 `--shot /tmp/runstrip.png`。

脚本检查：胶囊存在与阶段文案、与 composer 的间距、显示/隐藏前后 composer 高度不变、停滞状态、暗色表面、减少动态下的圆点动画、console error、样式表挂载。输出逐条 `PASS/FAIL`，失败时退出码为 1。

## 验证记录

以下为 1.0.0 的验收记录；1.1.0 的配置与浏览器验证见上一节。

- 插件在 `web` 档案中为 `enabled: true`、`fiberPhase: active`；Client 清单包含 `@local/stream-polish/client.js`。
- 计算样式：探针段落的 `animation-name: dshSP_blockIn`、时长 `0.16s`；末尾伪元素 `content: ""`、宽 `2px`、`animation-name: dshSP_caret`。
- 在真实回复上临时加 `data-streaming`，光标出现在末尾；移除后根节点立即带上 `data-dsh-sp-settling`，伪元素动画切换为 `dshSP_caretOut`。
- 落定序列：约 60ms 时 `opacity: 0.851`，冻结在 130ms 时 `opacity: 0.237`，340ms 后 settling 属性和伪元素都消失（`docs/caret-settle-sequence.png`）。
- 无重排：落定前后同一字符的 `charX/charY/charW`、`pH/pW` 差值为 `0/0/0`、`0/0`。
- `prefers-reduced-motion: reduce`：块动画为 `none`，光标动画为 `none`、透明度固定 `0.65`；落定时不加 settling 属性。
- 运行胶囊在真实 `bash` 工具执行期间显示 `Running Bash · 00:03 · active 3s ago`；同一命令 19 秒无输出后变为 `Running Bash · 00:19 · no new output for 19s`，圆点和文案转为琥珀色（`docs/runstrip-states.png`）。
- 运行胶囊出现/隐藏时 composer seat 的 `y/height` 完全不变（`735/165` 对 `735/165`）；亮色与暗色下背景、边框和文字都由主题 token 解析。
- 页面加载无 console error；插件页显示图标、标题与开关（`docs/plugin-row.png`）。

## 已知限制

- 光标只在以段落、标题、列表项或引用段落结尾时出现；正在写代码块或表格时没有光标。
- 运行胶囊的工具名来自运行行首行文本；DSH 改动运行行的文案或本地化标题时，会退化为 `Running commands` 或 `Thinking`。
- 停滞阈值由 `stallMs` 配置（默认 15 秒），但没有暂停、后台运行或完成通知，停止操作仍用 composer 自带的停止按钮。
- 设置页改的是本浏览器的覆盖值；档案里的默认值仍需编辑 `cordis.patch.yml` 并刷新一次页面。
- 在线升级只处理 git 走 `link:` 的安装方式；换成 tarball 或 npm 安装后按钮会明确报「不在 git 工作区」，需要走插件管理页。
- 升级的 Host 侧重载依赖 HMR；档案里关掉 HMR 时升级会完成但需要重启 `dsh`，页面会提示。
- 减少动态效果下不做落定淡出，光标会直接消失。
- 选择器依赖 `AssistantMarkdown` 当前的三层结构；DSH 大版本改结构时需要跟着调。

## 变更记录

### 1.1.0

- 新增 `config.js` 配置契约，12 个可配置项，默认值与 1.0.0 完全一致。
- Host 半由空 `apply` 改为校验行配置、按 `logLevel` 报告问题，并通过 `webserver/index-inject` 下发 `__DSH_STREAM_POLISH__`。
- Client 半按配置生成样式、开关观察器与运行胶囊，支持四层优先级与浏览器本地覆盖；保留 `__DSH_SP_STALL_MS__` 测试钩子。
- 新增 4 个测试文件（41 条断言），`npm test` 一条命令跑完；补 `npm run lint`。
- 无破坏性变更：包名、`exports` 既有入口、`apply` 语义与默认观感不变。

### 1.2.0

- 新增设置页（`settings.plugins.tab`）：12 个配置项全部可视化，改动立即生效，按差量存 `localStorage`，可一键恢复档案默认值。
- 设置页顶部新增**实时预览**：迷你对话片段按当前配置重放淡入、呼吸光标和胶囊，点「重播」再放一次；任何控件改动都会立刻反映在预览里。
- 本档案的 `cordis.patch.yml` 默认关掉运行胶囊（`stream-aura` 已占同一位置），随时可在设置页打开。
- 新增在线一键 git 升级：`/api/stream-polish/{info,update,update/apply}` 三个路由，快进 + 校验 + 失败回滚 + `hmr.reconcileProfile()` 热重载 Host 半。
- `enabled: false` 不再整体退出：设置页仍然可用，否则用户关掉后没有入口再打开。
- 测试从 41 条增加到 59 条：新增真实 git 仓库的升级测试、路由测试、设置存储/热更新测试。
- 无破坏性变更：包名、既有导出与默认观感不变；`apply` 仍然接受 `(ctx, config)`。
