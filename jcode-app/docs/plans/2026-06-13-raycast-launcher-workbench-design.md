# Raycast 启动器 + Agent 工作台 设计文档

> **目标**：将 `jcode-app` 从左侧导航的多页桌面窗口，重构成“全局快捷键启动器 + 可展开 Agent 工作台”两种形态共存的桌面应用。

---

## 1. 产品形态

### 1.1 启动器形态（Launcher）

- 全局快捷键（默认 `Option+Space`）唤起；失去焦点自动隐藏。
- 窗口尺寸约 720×420，居中显示，无边框或细边框。
- 默认展示命令列表：系统应用、最近 Session、内置页面指令（Providers / Team / Skills / MCP / Settings）。
- 用户输入默认用于过滤命令；只有选中 “Ask JCode” 或以 `ask ` 前缀输入时才进入 agent 查询。

### 1.2 工作台形态（Workbench）

- 通过启动器执行 agent 查询、打开某个 Session 或进入某个内置页面后，窗口平滑展开到 1200×800 的完整工作台。
- 工作台保留现有 `ChatArea`、会话列表、右侧面板等能力。
- 启动器快捷键在工作台内同样有效，用于快速切换命令而不离开当前上下文。

### 1.3 关键约束

- 不删除现有任何页面组件，只改变入口组织方式。
- 系统应用搜索通过 `applications-rs` 在后端实现，前端只负责展示。
- `cmdk` 已经作为依赖存在（v1.1.1），启动器 UI 基于它实现；不再引入 `react-cmdk`。

---

## 2. 窗口与生命周期

### 2.1 窗口模型

- 保留一个主窗口，通过 Tauri API 在两种尺寸/状态间切换：
  - `launcher`：居中、无边框、固定尺寸（720×420）、无标题栏、`alwaysOnTop: true`、失去焦点时隐藏。
  - `workbench`：可调整尺寸、有标题栏、保留之前的 1200×800 默认尺寸。
- 应用启动时进入 `launcher` 形态并隐藏；首次按快捷键时显示。
- 应用退出：默认隐藏到后台，保留托盘图标；通过托盘/命令退出。

### 2.2 生命周期状态机

```
hidden ──(hotkey)──► launcher
launcher ──(select app/session/page/agent)──► workbench
launcher ──(blur/esc)──► hidden
workbench ──(hotkey)──► launcher (不隐藏)
workbench ──(close button)──► hidden
workbench ──(select "back to launcher")──► launcher
workbench ──(quit)──► exit
```

### 2.3 Tauri 后端新增职责

- 注册全局快捷键（`tauri-plugin-global-shortcut`）。
- 监听窗口 `blur` 事件：若当前是 launcher 形态则隐藏。
- 提供命令：
  - `show_launcher` / `hide_launcher`
  - `expand_to_workbench(mode, payload?)`
  - `launch_application(path, args?)`
  - `search_applications(query)`
  - `list_recent_sessions()`
  - `get_builtin_commands()`
- 后端用 `applications-rs` 扫描 macOS 应用目录并缓存结果。

---

## 3. 启动器命令结构

启动器内部是一个统一的 `cmdk` 面板，所有可选项平铺在一个可搜索列表中，按语义分组。

### 3.1 命令来源与分组

1. **Applications（系统应用）**
   - 由后端 `applications-rs` 提供：`name`、`icon_path`、`bundle_identifier`、`executable_path`。
   - 前端用 Tauri 的 `convertFileSrc` 显示图标。
   - 操作：回车启动应用；启动后启动器隐藏。

2. **Sessions（最近会话）**
   - 来自后端 `list_sessions`。
   - 操作：回车恢复并展开工作台，进入对应 Session/Workspace。

3. **Builtin Commands（内置指令）**
   - 把原来的左侧导航页变成命令：
     - `Open Providers` → 展开工作台并打开 Provider 配置
     - `Open Team / Swarm` → 展开工作台并打开 Team 页
     - `Open Skills` → 展开工作台并打开 Skills 页
     - `Open MCP` → 展开工作台并打开 MCP 页
     - `Open Settings` → 展开工作台并打开 Settings 页
   - 每个内置指令有固定 keyword（`providers`, `team`, `skills`, `mcp`, `settings`）便于搜索。

4. **Agent Query（Agent 查询）**
   - 当输入以 `ask ` 开头，或用户选中 “Ask JCode” 项时，把后续内容作为自然语言查询。
   - 操作：创建/恢复默认 Session，发送消息，展开工作台。

### 3.2 搜索策略

- 输入空：默认展示最近使用的 5 个命令/应用/session（MRU 排序）。
- 输入非空：过滤名称、keyword、description。
- 当输入以 `ask ` 开头时，隐藏 Applications/Builtin/Sessions 分组，仅显示 Agent Query 项。

---

## 4. 工作台模式切换

### 4.1 展开后的三种模式

| 命令类型 | 工作台初始模式 |
|---|---|
| Agent Query | `chat` 模式，已创建/恢复 session，输入框已预填或直接发送 |
| Session | `chat` 模式，恢复指定 session |
| Builtin（Providers/Team/Skills/MCP/Settings） | 对应页面的全页模式，无 chat 输入框 |
| Application | 不展开工作台，只启动应用 |

### 4.2 内部状态调整

- `App.tsx` 中不再用左侧 NavBar 作为主导航，但仍保留一个简化版顶部/左侧工具条，方便在工作台内切换已打开的内置页面或返回 chat。
- `activeNavTab` 仍然有效，但用户更常通过启动器跳转。
- 新增 `appMode: "launcher" | "workbench"` 和 `pendingExpandPayload` 状态。

### 4.2 展开动画

- 通过 Tauri `Window` API 设置新尺寸和位置。
- 前端通过 CSS transition 做面板淡入。
- 动画顺序：先调整窗口大小/位置 → 再切换 React 路由 → 最后聚焦输入区。

---

## 5. Rust 后端集成 applications-rs

### 5.1 依赖与权限

- 在 `jcode-app/src-tauri/Cargo.toml` 中加入 `applications-rs`（来自指定 git 仓库）。
- Tauri 能力文件 `capabilities/default.json` 需要 `shell:allow-open` 或新增用于启动外部应用的权限。

### 5.2 后端模块

新增 `src-tauri/src/launcher.rs`：

```rust
pub struct AppInfo {
    pub name: String,
    pub bundle_id: Option<String>,
    pub icon_path: Option<String>,
    pub executable_path: String,
}

pub fn search_applications(query: &str) -> Vec<AppInfo> { ... }
pub fn launch_application(path: &str, args: Option<Vec<String>>) -> Result<(), String> { ... }
```

### 5.3 缓存策略

- 应用列表在启动器首次打开时扫描一次，缓存到 `AppState`。
- 提供后台刷新命令 `refresh_applications`（例如每分钟或每次打开时异步刷新，不阻塞 UI）。

### 5.4 图标处理

- `applications-rs` 返回图标路径后，通过 Tauri 的 asset URL 或 `convertFileSrc` 暴露给前端。

---

## 6. 前端新组件与数据流

### 6.1 新增组件

- `Launcher.tsx`：启动器主面板，基于 `cmdk` 的 `Command` 组件。负责搜索输入、分组列表、渲染 Agent Query 项。
- `LauncherCommandItem.tsx`：统一的命令项展示：图标、标题、描述、快捷键提示。
- `useLauncher.ts`：管理启动器状态：查询、MRU、命令来源、展开工作台的请求。
- `useApplications.ts`：调用 `search_applications` 和 `refresh_applications`。

### 6.2 数据流

```
全局快捷键 → Tauri 显示 launcher 窗口
              ↓
        Launcher 聚焦输入框
              ↓
        用户输入 / 选择
              ↓
        调用 invoke 命令
              ↓
        Tauri 执行（启动应用 / 展开工作台 / 创建 session）
              ↓
        若进入 workbench：窗口 resize + React 切到对应模式
```

### 6.3 工作台内快捷键

- 保持 `Cmd+K`（或自定义）唤回启动器。
- 工作台关闭按钮默认隐藏窗口而非退出应用。

### 6.4 错误处理

- 启动应用失败：在启动器底部显示临时错误提示。
- 创建 session 失败：停留在启动器，显示错误，不展开工作台。

---

## 7. 待后续实施计划细化

- 新增 Tauri 插件（global-shortcut、tray 等）的具体版本和配置。
- `applications-rs` 的实际 API 与错误映射。
- `Launcher` 与现有 `App.tsx` 的状态整合细节。
- 工作台展开/折叠的动画实现。
- 测试策略（Tauri 端到端、前端组件测试）。
