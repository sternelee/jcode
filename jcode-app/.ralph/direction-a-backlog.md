# Direction A — 功能闭环 (Backlog)

## /convene 真实广播
当用户在 workspace thread 发送 `/convene` 时，当前实现只是把它作为普通消息发送给 coordinator session。
真正的行为应该是：

### 目标行为
1. 检测消息内容是否以 `/convene` 开头
2. 向 workspace 内所有 **active** agent session 广播同一条消息（或 system-level trigger）
3. 每个 agent session 各自生成响应，响应通过 swarm 镜像机制汇聚到 workspace thread

### 实现思路
```
App.tsx handleSendMessage:
  if content.startsWith("/convene"):
    for session in workspaceSessions (all active):
      await sendMessage(content, undefined, session.sessionId)
```

也可以在 coordinator session 里用 jcode swarm 协议的 `NotifySession` 指令广播——
这需要查看 `src/server/client_api.rs` 的 `Request::NotifySession` 实现。

### 风险
- 多 session 并发发消息可能导致 UI 消息顺序乱序
- 需要去重（同一条用户消息不要在 workspace thread 显示多次）

---

## Agent DM 历史独立保存与恢复
当用户选中某个 DM（个别 agent session），切换后历史仍存在于 `state.sessionData`。
但如果 session 尚未 `resume`（connectionPhase 不是 connected），消息历史会是空的。

### 目标行为
1. 点击 DM → `resumeSession` 加载历史
2. 历史加载完成后，`sessionData[sessionId].messages` 填充
3. 再次点击 workspace thread → 保留 DM 历史，不清空

### 实现思路
- `handleResume` 已经调用 `resumeSession` — 后端会 emit `history` 事件 → 前端 `LOAD_HISTORY` action
- 当前问题：DM 里 `setSelectedConvId(session.sessionId)` 在历史加载前就切换了 displayMessages
  → 短暂空屏
- 修复：在 `displayMessages` 里，如果 sessionData 为空但有消息在加载中，显示 skeleton

---

## 状态：Backlog（暂不实现，B 方向 polish 完成后再做）
