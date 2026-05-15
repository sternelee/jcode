# Slack Mode 完整流程审查报告

## 数据流总览

```
用户输入 → InputArea.parseTargetRole → ChatView.onSend/onQueueSend
  → App.tsx: findSessionIdByRoleName / getDefaultRoleSessionId
    → useJcodeSession.sendMessage / queueMessage
      → invoke("send_message", { sessionId: targetSessionId })
        → Rust: get_or_load_session_runtime (可能静默加载)
          → agent.run_once_streaming_mpsc → mpsc channel
            → reader task: emit "server-event" + session_id
              → 前端 listener:
                ① processEvent(payload, dispatch, realSessionId)
                ② if slack mode: processEvent(payload, dispatch, virtualSessionId, skip=true, roleSessionId, roleName)
                  → reducer → state update → React re-render
```

---

## 🔴 Critical Issues (导致功能完全不可用)

### Issue 1: 静默加载的 session 前端 `connectionPhase` 为 null → Slack 模式输入框被禁用

**位置**: `lib.rs` `load_session_runtime_silently` + `App.tsx` `slackConnected`

**现象**:

- Slack 模式下，如果目标 session 是首次被 `send_message` 触发的自动加载（不在内存中）
- 后端加载成功，agent 开始运行，事件正常 emit
- 但前端 `sessionData[sessionId].connectionPhase` 始终是 `null`（`getOrCreateSessionData` 的默认值）
- `slackConnected = workspaceSessions.some(s => sessionData[s.sessionId]?.connectionPhase === "connected")` → **false**
- ChatView 的 `connected={slackConnected}` → false
- InputArea `disabled={!connected}` → **true，输入框被禁用**

**根因**: `load_session_runtime_silently` 故意不 emit `connection_phase` 事件，避免干扰 UI。但前端依赖 `connectionPhase === "connected"` 来判断连接状态。

**修复**:

- 方案 A: `load_session_runtime_silently` emit 一个 `connection_phase: connected` 事件（只更新该 session 的 sessionData，不改 active session）
- 方案 B: `slackConnected` 改为同时检查 `isProcessing` 或 `messages.length > 0` 作为替代信号
- **采用方案 A** —— 语义正确，不影响 Slack UI

### Issue 2: Slack 模式下队列消息永远不会自动发送

**位置**: `useJcodeSession.ts` `queueMessage` + auto-dequeue `useEffect`

**现象**:

- 用户在 Slack 模式下，角色 A 正在回复时发送新消息
- InputArea 检测到 `isProcessing=true`，调用 `onQueueSend`
- `queueMessage(content, images, targetSessionId)` 将 draft 加入 `sessionData[targetSessionId].queuedDrafts`
- auto-dequeue effect:
  ```ts
  useEffect(() => {
    if (state.isProcessing || !state.connected || ...) return;
    const nextDraft = state.queuedDrafts[0]; // ← 这是 state.sessionId 的队列！
    void performSend(nextDraft.content, nextDraft.images, state.sessionId || undefined);
  }, [..., state.sessionId]);
  ```
- `state.queuedDrafts` 是**当前 active session**的队列，不是 `targetSessionId` 的
- `targetSessionId` 的 draft 永远停留在队列中，不会触发 performSend

**根因**: 队列系统是为单 session 设计的。`state.queuedDrafts` 和 auto-dequeue 都只关联 `state.sessionId`。

**修复**:

- Slack 模式下**不使用前端队列**，直接调用 `sendMessage`
- 后端 agent 的 `Mutex` 已经天然排队（`runtime.agent.lock().await`）
- 简化 InputArea：Slack 模式下 `isProcessing` 时仍直接 send，不 queue

### Issue 3: `targetSessionId` 为 undefined 时消息被静默丢弃

**位置**: `App.tsx` `onSend` / `onQueueSend`

**现象**:

```tsx
onSend={(content, images, targetRole) => {
  const targetSessionId = targetRole
    ? findSessionIdByRoleName(targetRole)
    : getDefaultRoleSessionId();
  if (targetSessionId) {  // ← undefined 时直接跳过，无反馈
    sendMessage(content, images, targetSessionId);
  }
}}
```

- 用户 @mention 了一个不存在的角色 → 消息消失，无任何提示
- workspace 中没有 role session → 消息消失，无任何提示

**修复**: 添加错误提示（dispatch error 或 alert）

---

## 🟠 High Issues (严重影响 UX)

### Issue 4: Slack 模式下多个角色同时回复时，只有最后一条消息显示 streaming 光标

**位置**: `ChatView.tsx` `isStreaming` 计算

**现象**:

```tsx
isStreaming={isVisibleRegion && msg.id === lastMessageId && isProcessing}
```

- 角色 A 和角色 B 同时回复
- 消息列表: [A1, A2, A3(streaming), B1, B2(streaming)]
- `lastMessageId = B2.id`
- 只有 B2 显示 ▌光标，A3 不显示
- 用户无法直观判断 A 是否还在生成

**修复**: 改为 `isStreaming={isVisibleRegion && msg.isStreaming}`

### Issue 5: 创建角色/会话后侧边栏不自动刷新

**位置**: `useJcodeSession.ts` `createRoleSession` / `connect`

**现象**:

- 用户点击 "Create Role"
- 后端 `begin_session` 成功，session 写入磁盘
- 但前端 `state.sessions` 未更新
- 侧边栏看不到新角色，需要手动刷新

**修复**: `createRoleSession` 和 `connect` 成功后调用 `listSessions()`

### Issue 6: `@role `（仅提及无内容）时消息内容错误

**位置**: `InputArea.tsx` `parseTargetRole` + `handleSubmit`

**现象**:

```ts
const match = content.trim().match(/^@(S+)s*(.*)$/);
// 输入 "@Coder " → match[2] = ""
const finalContent = cleanContent || content || "(image)";
// "" || "@Coder " || "(image)" → "@Coder "
```

- 后端收到消息内容是 "@Coder"，角色 Coder 收到自己的 @mention 作为消息内容

**修复**: `finalContent = cleanContent.trim() || "(image)"`

---

## 🟡 Medium Issues

### Issue 7: Slack 模式下没有 role session 时，消息被静默丢弃

**位置**: `App.tsx` `getDefaultRoleSessionId`

**现象**:

```tsx
return workspaceSessions.find((s) => s.roleName)?.sessionId;
```

- 只返回有 roleName 的 session
- 如果 workspace 只有普通 session（无角色），返回 undefined

**修复**: fallback 到第一个 session：`workspaceSessions[0]?.sessionId`

### Issue 8: Slack 模式下 cancel 只取消有 `isProcessing` 标记的 session

**位置**: `App.tsx` `onCancel`

**现象**:

```tsx
workspaceSessions
  .filter((s) => state.sessionData[s.sessionId]?.isProcessing)
  .forEach((s) => void cancel(s.sessionId));
```

- 如果 session 正在被 `load_session_runtime_silently` 加载但还没有 emit 任何事件，`sessionData[s.sessionId]` 可能不存在
- 但实际上 `send_message` 设置了 `runtime.is_processing = true`，事件应该很快就会来
- 不算严重问题

### Issue 9: `load_session_runtime_silently` 不应用 memory 设置

**位置**: `lib.rs` `load_session_runtime_silently`

**现象**:

- `begin_session` 会调用 `agent.set_memory_enabled(resolved_memory_enabled)`
- `load_session_runtime_silently` 没有这个步骤
- 如果 session 文件本身保存了 memory 状态，可能从 `Session::load` 恢复
- 需要确认 `Agent::new_with_session` 是否自动恢复 memory 设置

---

## 修复优先级

| 优先级 | 问题                                         | 影响                               |
| ------ | -------------------------------------------- | ---------------------------------- |
| P0     | Issue 1: 静默加载 session 无 connectionPhase | Slack 模式输入框被禁用，完全不可用 |
| P0     | Issue 2: Slack 队列消息不自动发送            | 多消息时后续消息丢失               |
| P1     | Issue 3: targetSessionId undefined 静默丢弃  | 用户消息消失，无反馈               |
| P1     | Issue 4: 多角色 streaming 光标只显示最后一个 | UX 混乱                            |
| P2     | Issue 5: 创建角色后侧边栏不刷新              | 需要手动刷新                       |
| P2     | Issue 6: @role 无内容时消息内容错误          | 发送了错误内容                     |
| P2     | Issue 7: 无 role session 时消息丢弃          | Slack 模式无角色时无法使用         |
