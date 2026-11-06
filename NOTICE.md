# 声明 / Notice

**范围**：`@local/stream-polish` 只改变显示。它不写入 Session 事件、模型输入、工具结果或滚动位置；停用插件后原有界面原样恢复。

**隐私**：思考翻译只会把你主动展开的思考片段发送给所选翻译服务（Bing / Google）。插件本身不收集、不上报任何数据；配置只保存在当前浏览器的 `localStorage` 中。官方翻译服务可能限流、不可用或改变响应格式；失败时保留原文。

**在线升级**：只对插件目录执行 `git fetch` 与 `git merge --ff-only`；脏工作区、本地领先、包名变化都会拒绝，失败会回滚，不改写其他文件。升级后的 Host 半通过 Loader 的 `hmr.reconcileProfile()` 重载。

**设计方法**：本插件详情页按 unslop 方法重做。unslop by Damir Sokolovsky（[@heydamir](https://x.com/heydamir)），CC BY 4.0。方法说明见 <https://github.com/heydamir/unslop>。
