# JCode Desktop App - TODO / Feature Gap Analysis

> 对比 jcode CLI/TUI 完整功能后，识别出的待实现功能清单。
>
> 目标：让 jcode-app 支持 jcode CLI/TUI 的全部能力（memory, swarm, mcp, skill 等），但不依赖 jcode CLI 侧边栏。

---

## ✅ 已支持的功能

### 会话管理
- [x] `begin_session` — 开始新会话
- [x] `resume_session` — 恢复会话
- [x] `list_sessions` — 列出会话
- [x] `delete_session` — 删除会话
- [x] `delete_workspace_sessions` — 删除工作区会话
- [x] `clear_chat` — 清空当前会话
- [x] `rewind_chat` — 回退到指定消息
- [x] `compact_context` — 手动压缩上下文

### 消息交互
- [x] `send_message` — 发送消息
- [x] `cancel` — 取消当前响应
- [x] `send_stdin_response` — 响应 stdin 提示

### 模型/提供商
- [x] `get_models` — 获取可用模型列表
- [x] `set_model` — 切换模型
- [x] `save_provider_api_key` — 保存 API key
- [x] `start_provider_auth_flow` — 启动 OAuth 认证（内部 API）
- [x] `complete_provider_auth_flow` — 完成 OAuth 认证（内部 API）

### 推理与设置
- [x] `set_reasoning_effort` — 设置推理 effort

### MCP 工具
- [x] 自动注册 MCP 工具（`create_agent` / `create_agent_with_session` 中调用 `register_mcp_tools()`）

### Memory（基础）
- [x] `set_memory_enabled` — 开关记忆功能
- [x] `get_workspace_memory_preferences` — 获取工作区记忆偏好
- [x] `set_workspace_memory_preference` — 设置工作区记忆偏好

### Swarm（事件级）
- [x] 接收并解析 swarm_status / swarm_plan / swarm_proposal 事件
- [x] 在会话列表中显示 swarm 状态（swarm_enabled, swarm_peer_count, swarm_role）

### Skill（隐式）
- [x] Agent 内部通过 prompt 注入使用 skill

---

## 🔴 高优先级（直接影响日常使用）

### Memory 高级管理
需要新增 Tauri 命令 + 前端 UI：
- [ ] `memory_list` — 列出所有记忆（支持 scope: project/global/all, tag 过滤）
- [ ] `memory_search` — 搜索记忆（支持关键词和语义搜索）
- [ ] `memory_export` — 导出记忆到 JSON 文件
- [ ] `memory_import` — 从 JSON 文件导入记忆
- [ ] `memory_stats` — 显示记忆统计信息
- [ ] `memory_clear_test` — 清除测试记忆存储

### Session 管理
- [ ] `session_rename` — 重命名会话

### Provider 管理
- [ ] `provider_list` — 列出现有提供商配置
- [ ] `provider_current` — 显示当前解析的提供商
- [ ] `provider_add` — 添加 OpenAI 兼容提供商配置

### Auth 诊断
- [ ] `auth_status` — 显示所有配置提供商的认证状态
- [ ] `auth_doctor` — 诊断认证问题并建议修复步骤

---

## 🟡 中优先级（增强体验）

### Memory 数据管理
- [ ] 记忆详情查看（点击记忆条目查看完整内容）
- [ ] 记忆编辑/删除单个记忆

### 配对与同步
- [ ] `pair` — 生成/管理 iOS/web 客户端配对码
- [ ] `pair_list` — 列出已配对设备
- [ ] `pair_revoke` — 撤销配对设备

### 基本信息
- [ ] `version` — 显示版本/构建信息
- [ ] `usage` — 显示提供商使用限制

---

## 🟢 低优先级（高级/特殊场景）

### Ambient 模式
- [ ] `ambient_status` — 查看环境模式状态
- [ ] `ambient_log` — 查看近期活动日志
- [ ] `ambient_trigger` — 手动触发环境周期
- [ ] `ambient_stop` — 停止环境模式

### 语音输入
- [ ] `transcript` — 将外部转录文本注入活动会话
- [ ] `dictate` — 口述输入

### 会话回放
- [ ] `replay` — 回放保存的会话
- [ ] `replay_swarm` — 回放 swarm 相关会话
- [ ] `replay_video` — 导出会话为视频

### 系统级集成
- [ ] `setup_hotkey` — 设置全局热键 (Alt+;)
- [ ] `setup_launcher` — 安装启动器
- [ ] `browser_setup` — 浏览器自动化设置

### 诊断与恢复
- [ ] `auth_test` — 端到端认证测试
- [ ] `restart_save` — 保存重启快照
- [ ] `restart_restore` — 恢复重启快照
- [ ] `restart_status` — 查看重启快照状态
- [ ] `restart_clear` — 清除重启快照

---

## 🔧 技术债务 / 改进项

### 架构改进
- [ ] 将 `lib.rs`（~2300 行）拆分为模块（commands/, handlers/, events/）
- [ ] 统一错误处理模式（当前部分用 `String`, 部分用 `anyhow::Result`）
- [ ] 添加后端单元测试（当前 jcode-app 无测试）

### Swarm 管理
- [ ] 显式 swarm 创建/加入/离开命令（当前只读事件解析）
- [ ] Swarm 协调者选举 UI
- [ ] Swarm 成员列表和角色显示

### Skill 管理
- [ ] Skill 激活命令（`set_active_skill`）
- [ ] Skill 列表查看
- [ ] Skill 可用命令提示

### 配置管理
- [ ] 配置查看/编辑 UI
- [ ] 环境变量管理

---

## 📝 已完成的工作

- [x] 2026-05-11: 消除外部 jcode CLI 依赖 — 将认证流程从外部 CLI 调用改为内部 API 调用
  - `start_scriptable_login_data()` / `complete_scriptable_login_data()` 数据返回函数
  - Tauri `.setup()` 钩子设置 `JCODE_HOME` 到 app data dir

---

## 参考文档

- `../src/cli/args.rs` — jcode CLI 完整命令定义
- `../src/cli/commands.rs` — jcode CLI 命令实现
- `./CLAUDE.md` — jcode-app 架构说明
- `../docs/` — jcode 架构文档
