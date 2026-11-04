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
| `client.js` | Client 半：样式表、settling 观察器、运行观察器、运行胶囊 |
| `index.js` | Host 半：空 `apply`，让插件出现在 Loader 中 |
| `cordis.patch.yml` | 插入 `stream-polish` 行 |
| `locale/zh.json`、`locale/en.json` | 插件管理页的标题与描述 |
| `icon.svg` | 原创图标 |
| `test/run.py` | 单次加载的验收 harness（9 条断言，可覆盖 stall 阈值） |
| `docs/*.png`、`docs/*.gif` | 光标、落定序列、运行胶囊和插件页截图 |

## 安装

当前 `web` 档案已经安装并启用。重新安装或换档案时：

```bash
# 在 agent 会话里
plugin_manager install_bundle target=link:/home/ubuntu/ctomall/stream-polish
```

或者手动把 `"@local/stream-polish": "link:/home/ubuntu/ctomall/stream-polish"` 加进档案的 `package.json` 依赖与 `dsh.profile.bundles`，再 `pnpm install`。

安装后刷新一次页面；之后由 Client HMR 接管。

## 测试

一条命令、一次页面加载、9 条断言，不读截图、不真等 15 秒：

```bash
python3 stream-polish/test/run.py --stall-ms 800
```

`--stall-ms` 会在页面脚本加载前写入 `window.__DSH_SP_STALL_MS__`，覆盖插件默认的 15000ms；默认值不变。需要最终截图时加 `--shot /tmp/runstrip.png`。

脚本检查：胶囊存在与阶段文案、与 composer 的间距、显示/隐藏前后 composer 高度不变、停滞状态、暗色表面、减少动态下的圆点动画、console error、样式表挂载。输出逐条 `PASS/FAIL`，失败时退出码为 1。

## 验证记录

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
- 停滞阈值固定 15 秒，还不能在设置里调；也没有暂停、后台运行或完成通知，停止操作仍用 composer 自带的停止按钮。
- 减少动态效果下不做落定淡出，光标会直接消失。
- 选择器依赖 `AssistantMarkdown` 当前的三层结构；DSH 大版本改结构时需要跟着调。
