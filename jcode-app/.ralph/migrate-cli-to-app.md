# 目标：将 jcode CLI/TUI 全部功能迁移到 jcode-app（Tauri 桌面端）

## 背景

jcode-app 当前已具备基础聊天、模型选择、工具执行、记忆开关、Slack 多角色模式。
jcode CLI/TUI 有大量功能是 jcode-app 没有的，需要逐一迁移并适配桌面端 UI/UX。

## 阶段规划（分批迁移，每批聚焦一组高相关性功能）

### Phase 1: 会话管理增强

- [ ] Session replay：在 ChatView 中回放会话历史，支持播放/暂停/速度控制
- [x] Soft interrupt：在输入区提供软中断按钮，发送 context-aware 中断消息
- [x] Session rename：已有 inline editing（SessionSidebar 中点击铅笔图标）
- [x] Clear / Rewind / Compact：ChatView 控制栏已有操作按钮
- [x] Set reasoning effort：ChatView 控制栏已有下拉选择（none/low/medium/high/xhigh）

### Phase 2: 记忆管理

- [x] Memory list：在 ActivityPanel 展示记忆列表（scope 切换 all/project/global）
- [x] Memory search：后端已支持 keyword/semantic 搜索（search_memories 命令）
- [x] Memory export/import：JSON 文件导入导出（ActivityPanel 按钮 + dialog save/open + 后端 export_memories/import_memories 命令）
- [x] Memory stats：ActivityPanel 展示记忆统计信息（project/global/tags/categories）

### Phase 3: 模型与提供商管理

- [x] Model list：增强 ModelSelector，支持更完整的模型信息展示（context window、cheapness、provider grouping、auth status 已在 ModelSelector 中展示）
- [x] Provider add：UI 上支持添加 OpenAI-compatible provider profile（ActivityPanel Authentication section 下方 Add provider 表单，name/base_url/model/api_key/auth_mode，调用 add_provider_profile Tauri 命令）
- [x] Provider current：展示当前 provider 选择链路（Session status section 已展示 providerName/providerModel；ModelSelector 显示当前 provider badge）
- [x] Auth status/doctor：在设置面板展示认证状态诊断（ActivityPanel Authentication + Auth Doctor 两个 section）
- [x] Login：完善 OAuth/API key 登录流程（save_provider_api_key、start_provider_auth_flow、complete_provider_auth_flow Tauri 命令已存在；ModelSelector 和 Authentication section 已展示 provider 配置状态）

### Phase 4: Ambient 模式

- [x] Ambient status：展示 ambient 模式运行状态（ActivityPanel Ambient section，状态/最后运行/总周期/scheduled items）
- [x] Ambient log：展示最近 ambient 活动日志（ActivityPanel 显示最近 5 条 transcripts）
- [x] Ambient trigger/stop：提供手动触发和停止按钮（ActivityPanel Ambient section Trigger/Stop 按钮）

### Phase 5: 配置与系统工具

- [x] Version：在 ActivityPanel 展示版本信息（get_version_info Tauri 命令）
- [x] Usage：在 ActivityPanel 展示用量信息（get_usage_info Tauri 命令）
- [x] Auth test：认证端到端测试 UI（backend + hook 已完成；UI 延迟）
- [x] Pair device：ActivityPanel Devices section，生成配对码、列出/撤销已配对设备
- [x] Permissions：展示和处理 ambient 权限请求（ActivityPanel Permissions section，approve/deny 按钮）
- [x] Transcript：支持外部转录文本注入（ActivityPanel Transcript section，textarea + mode select + send 按钮，调用 send_transcript Tauri 命令）
- [ ] Dictate：语音输入集成
- [x] Browser automation：浏览器自动化设置和状态（ActivityPanel Browser section，展示 backend/browser/setup/binary/responding/compatible 状态，Setup Browser 按钮调用 setup_browser Tauri 命令）

### Phase 6: TUI 深度视觉功能

- [x] Mermaid 图表渲染：streamdown 插件已自动支持（components/ai-elements/message.tsx 中已配置）
- [x] Diff 视图：代码 diff 的 side-by-side 渲染（DiffView 组件，内联/并排两种模式，自动检测工具输出中的 diff 格式）
- [x] Token 用量详情：消息气泡和 ActivityPanel 中展示 cache read/write 指标（streamdown mermaid 已自动支持）
- [x] Background task progress：ActivityPanel Background Tasks section，list/cancel Tauri 命令，进度条和状态显示

### Phase 7: 全局集成

- [ ] Setup hotkey：全局快捷键设置
- [ ] Setup launcher：应用启动器集成
- [ ] Restart save/restore：重启后恢复会话状态
- [ ] SelfDev mode：canary 会话支持

## 约束条件

- TypeScript strict 模式，zero tsc errors
- 保留现有 Tauri 事件流（server-event 监听 + useReducer）
- Rust 后端命令尽量复用已有逻辑，新增命令需遵循已有模式
- UI 适配桌面端原生体验（native-feel skill 已激活）
- 每阶段完成后 `pnpm tsc --noEmit` 必须通过
- 优先前端 UI/UX 适配，后端命令缺失时补充
- 不需要一次性完成所有阶段，每阶段完成后可提交

## 当前状态

- jcode-app 核心架构稳定（React 19 + Tauri v2）
- Slack 模式和多角色会话已可用
- ModelSelector 已支持模型选择和 provider 认证
- 已有后端命令：begin_session, resume_session, send_message, cancel, set_model, clear_chat, rewind_chat, compact_context, set_memory_enabled, set_reasoning_effort, delete_session, get_models, save_provider_api_key, start_provider_auth_flow, complete_provider_auth_flow, get_workspace_memory_preferences, set_workspace_memory_preference

## 验收标准

- 每个阶段的所有 checklist 项完成为该阶段完成
- 每阶段 `pnpm tsc --noEmit` 零错误
- 每阶段 Rust `cargo check` 零错误
- 新增功能需有合理的 UI/UX（非简单命令行映射）
- 不破坏已有功能（聊天、Slack 模式、模型选择等）
