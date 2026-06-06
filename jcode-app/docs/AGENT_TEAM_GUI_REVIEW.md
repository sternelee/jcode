# Agent Team GUI Review: jcode Desktop + Swarm Architecture

**Date:** 2026-06-06  
**Scope:** jcode-app (Tauri desktop) + jcode server/swarm stack  
**Goal:** Evaluate current desktop app as a GUI for jcode's server-backed swarm Agent team capability

---

## 1. Executive Summary

The jcode desktop app (`jcode-app/`) has built an impressive **Team UI shell** — workspace-scoped agent groups, role presets, virtual workspace chat threads with @mention, plan/proposal display, and a Team overview page. However, it is **not yet a reliable swarm control surface** because the desktop creates local Agent runtimes directly, while the actual swarm coordination engine lives inside the jcode server (`jcode serve`).

The `swarm` tool (used by agents) connects to the server Unix socket and uses the full `comm_*` protocol (spawn, assign, plan, DM, broadcast). The desktop app bypasses this protocol entirely. This creates a **split-brain** situation where:
- Desktop thinks it has a "team" (local runtimes with role names)
- Server may have an entirely separate swarm (spawned via `comm_spawn` by a coordinator running in the TUI or another client)
- The desktop cannot see, control, or interact with server-side swarms

**Verdict:** The UI layer is ~70% ready for an Agent Team console. The backend integration is ~20% ready. The critical path is migrating the desktop from a "direct Agent runtime" to a "server protocol client."

---

## 2. Architecture Review

### 2.1 Current Desktop Architecture (Direct-Agent Model)

```
Frontend (React)
  └─► invoke("begin_session") / invoke("begin_swarm")
        └─► Tauri command
              └─► create_agent_with_session(provider, session)
                    └─► register_runtime_and_emit(state, agent)
                          ├─► AppState.runtimes.insert(session_id, runtime)
                          ├─► stdin_rx loop → pending_stdin HashMap
                          └─► emit "server-event" → frontend reducer
```

**Problems with this model for swarm:**

| Issue | Severity | Detail |
|-------|----------|--------|
| No server connection | **Blocker** | Desktop never connects to `jcode.sock`. Swarm tool (`communicate`) does, but as an agent-side tool, not as the GUI control plane. |
| Parallel session universes | **Blocker** | Server swarms and desktop swarms are disjoint. A desktop "team" is invisible to `comm_list`. A server swarm is invisible to the desktop session list. |
| No swarm protocol exposure | **Blocker** | Tauri commands do not expose `CommSpawn`, `CommStop`, `CommAssignTask`, `CommApprovePlan`, etc. The GUI cannot perform swarm operations. |
| Direct stdin routing | **High** | `pending_stdin` is local to AppState. Server-side agents requesting stdin go to the server, not the desktop. |
| Lifecycle mismatch | **High** | Server swarm members outlive the desktop app. Desktop members die when the app closes. |
| Coordinator model bug (fixed) | **Med** | Was using `provider.model()` instead of `coordinator_provider.model()` — now fixed. |
| Role metadata inference | **Med** | `role_name` inferred from `custom_title` only when swarm events exist; fixed by persisting immediately. |

### 2.2 Target Architecture (Server-Backed Swarm Client)

```
Frontend (React)
  └─► invoke("connect_to_server") or auto-connect on launch
        └─► Tauri spawns/connects to jcode server daemon
              └─► Unix socket protocol (Request / ServerEvent)
                    ├─► Server owns all sessions, agents, swarm state
                    ├─► Desktop subscribes to session events
                    └─► Desktop sends commands via socket proxy
```

The desktop should become a **first-class jcode client** alongside the TUI:

```
jcode serve (daemon)
  ├─► Unix socket /run/user/$UID/jcode.sock
  │     ├─► TUI client connects
  │     ├─► Desktop client connects  ◄── NEW
  │     └─► Agent communicate tool connects
  │
  └─► Session runtime (Agent + Registry + Tools)
        └─► Swarm coordination (comm_* handlers)
```

### 2.3 What the Server Protocol Already Provides

The jcode protocol (`crates/jcode-protocol/src/wire.rs`) has everything needed:

**Lifecycle:** `CommSpawn`, `CommStop`, `CommAssignRole`  
**Tasking:** `CommAssignTask`, `CommAssignNext`, `CommTaskControl` (start/wake/resume/retry/reassign/replace/salvage)  
**Planning:** `CommProposePlan`, `CommApprovePlan`, `CommRejectPlan`, `CommPlanStatus`, `CommResyncPlan`  
**Communication:** `CommMessage` (DM, broadcast, channel), `CommSubscribeChannel`, `CommUnsubscribeChannel`  
**Inspection:** `CommStatus`, `CommSummary`, `CommReadContext`, `CommList`, `CommListChannels`  
**Coordination:** `CommReport`, `CommAwaitMembers`, `CommShare`, `CommRead`  
**Events:** `SwarmStatus`, `SwarmPlan`, `SwarmPlanProposal`, `Notification`, `CommMembers`, `CommChannels`, `CommStatusResponse`, etc.

**This is a mature, feature-complete swarm control API.** The desktop doesn't use it.

### 2.4 Migration Path: Desktop as Server Client

Rather than incrementally patching the direct-agent model, the desktop should migrate to being a **protocol client** of the jcode server. Recommended approach:

#### Phase A: Server Bridge in Tauri (Minimal Viable)

Add a Tauri command layer that proxies to the server socket:

```rust
// New: src-tauri/src/server_client.rs
async fn server_request(req: Request) -> Result<ServerEvent, String> {
    let path = jcode::server::socket_path();
    let stream = connect_socket(&path).await?;
    // send request, read response (same logic as communicate transport)
}

#[tauri::command]
async fn comm_spawn(...) -> Result<CommSpawnResponse, String> { ... }
#[tauri::command]
async fn comm_stop(...) -> Result<(), String> { ... }
#[tauri::command]
async fn comm_list(...) -> Result<Vec<AgentInfo>, String> { ... }
// ... etc for all comm_* operations
```

The desktop keeps its current event pipeline (`server-event` / `workspace-event`) because the server already emits the right events. The change is **where sessions come from**.

#### Phase B: Session Lifecycle via Server

Replace `begin_session` → local Agent with:
1. `Request::Subscribe` to server (or `ResumeSession`)
2. Server emits `SessionId`, `History`, streaming events
3. Desktop renders them exactly as today

For swarm:
1. User clicks "Launch Agent Team"
2. Frontend invokes `begin_coordinator_session` (server command)
3. Server creates coordinator session
4. Coordinator (the agent) uses `swarm` tool with `comm_spawn` to create members
5. Desktop receives `SwarmStatus`, `SwarmPlan` events via subscription

**Key insight:** The desktop does NOT need to call `begin_swarm` directly. It creates a coordinator session. The coordinator agent uses the `swarm` tool to build the team. The desktop observes and controls via the protocol.

#### Phase C: Hybrid Mode (Optional Fallback)

Keep direct-agent mode for offline/air-gapped use, but make server-client the default. Add a toggle: "Local Mode" vs "Server Mode."

---

## 3. UI/UX Review

### 3.1 What's Working Well

| Feature | Assessment |
|---------|------------|
| **Workspace-scoped sessions** | Clean. Sessions grouped by `working_dir`. Swarm mode per workspace. |
| **Virtual workspace thread** | Excellent pattern. `workspace-event` unifies multi-agent output into a single chat. |
| **@mention** | Well implemented. Agent + file suggestions. Keyboard navigation. |
| **Agent presence** | Status dots, "responding" indicators, agent count bar. Good affordances. |
| **Role presets** | `TeamPage` has configurable presets with model overrides. Useful for repeatable team setups. |
| **Per-agent model** | ChatArea popover lets changing model per member. |
| **Plan/proposal display** | TeamPage shows plan stats (ready/active/blocked) and proposals. |
| **Convene button** | One-click `/convene` to trigger team discussion. |
| **Theme + styling** | Tailwind v4 + shadcn. Clean, consistent. |

### 3.2 What's Missing for an Agent Team Console

The UI currently resembles a **chat app with agent labels**. An Agent Team console needs to be a **mission control surface** for supervising autonomous work.

#### A. Operational Controls (TeamPage)

Current TeamPage is a **read-only dashboard**. It needs to become a **control panel**.

Missing controls:
- **Spawn agent** (with role preset, model, working_dir)
- **Stop/kill agent** (graceful or force)
- **Assign task** (pick from plan, assign to specific agent)
- **DM agent** (send direct message / soft interrupt)
- **Broadcast to team** (send message to all members)
- **Approve/reject proposal** (plan governance buttons)
- **Restart agent** (stop + spawn replacement)
- **Promote/demote role** (assign_role: coordinator / worktree_manager / agent)
- **Subscribe to channel** (join topic channels)

Recommended layout:

```
┌─────────────────────────────────────────────┐
│ Team "fox"                        [Spawn +] │
├──────────────┬──────────────────────────────┤
│ Agents       │ Plan DAG (interactive graph) │
│ ├─ Atlas ✅  │ ┌─────┐    ┌─────┐          │
│ ├─ Bram 🔨   │ │ API │───►│Test │          │
│ ├─ Nova 💤   │ └─────┘    └─────┘          │
│ └─ ...       │                              │
│              │ [Assign] [Approve] [Reject]  │
├──────────────┼──────────────────────────────┤
│ Channels     │ Activity Feed                │
│ #general     │ ├─ Atlas: started read(...)  │
│ #parser      │ ├─ Bram: completed refactor  │
│ #tests       │ └─ Nova: proposed plan v2    │
└──────────────┴──────────────────────────────┘
```

#### B. Plan Visualization

Current plan display is **3 stat cards** (Ready / Active / Blocked count).

Swarm architecture specifies a **plan DAG graph** with:
- Task nodes showing owner, scope, status
- Dependency edges
- Critical path highlighting
- Checkpoint badges
- Click to inspect / assign / reassign

This needs a visual graph component (even a simple CSS/HTML one, not necessarily canvas/D3).

#### C. Agent Lifecycle Visualization

The swarm architecture defines 8 lifecycle states:
`spawned → ready → running → blocked → completed → failed → stopped → crashed`

Current UI only shows: "Working" / "Ready" / "Thinking..."

Should show:
- Full state with color coding
- Current task / intent
- Tool currently executing
- Last completion report snippet
- Blocker reason (if blocked)
- Failure reason (if failed)
- Heartbeat age

#### D. Communication Interface

Swarm supports DM, broadcast, and topic channels. The desktop has no UI for this.

Needed:
- Channel list sidebar (like Slack/Discord)
- Channel message view
- Send DM to specific agent
- Broadcast message to all members
- Delivery mode selector (notify / interrupt / wake)

#### E. Task Assignment Console

Current "Convene" button sends `/convene` to the coordinator. That's one action.

Users need:
- View plan tasks with status
- Drag/drop or click to assign task to agent
- See in-flight tasks
- Retry / reassign / replace failed tasks
- Set concurrency limit
- Trigger `run_plan` (auto-fill slots until terminal)

#### F. Worktree Management

Swarm architecture has **Worktree Managers** for git worktree isolation. Desktop has no concept of this.

If worktrees are used, the UI should show:
- Worktree groups
- Which agents belong to which worktree
- Integration status (pending / in-progress / merged)
- Changed files per worktree

### 3.3 Information Architecture Issues

| Issue | Detail |
|-------|--------|
| Session vs Workspace confusion | `workspace:${id}` virtual sessions hold workspace chat. Real sessions hold agent runtimes. Users may not understand the distinction. |
| Plan stored per-session | `swarmPlan` is stored on each `SessionInfo`. The canonical plan is server-scoped by `swarm_id`. Frontend should treat plan as workspace-level, not session-level. |
| No swarm ID in workspace state | `SessionState` has no top-level `swarmId`. Makes it hard to correlate sessions, plan, and channels. |
| Missing server connection status | No UI indication of whether desktop is connected to jcode server daemon. |

### 3.4 Frontend State Model Gaps

The `sessionReducer` handles swarm events well (`APPLY_SWARM_STATUS`, `APPLY_SWARM_PLAN`, `APPLY_SWARM_PROPOSAL`), but:

- No action for `Notification` events (file conflicts, agent messages)
- No action for `CommChannels` (channel list)
- No action for `CommContext` (shared context)
- No action for `CommTaskControlResponse` (task lifecycle updates)
- No top-level swarm state (channels, shared context, task assignments)

---

## 4. Recommendations (Prioritized)

### P0: Server-Client Migration (Architecture)

This is the foundation. Everything else builds on it.

1. **Add server socket client to Tauri backend**
   - Reuse `connect_socket` from `jcode::server` (already in workspace)
   - Create proxy commands for `comm_*` protocol operations
   - Maintain event subscription loop, emit Tauri events

2. **Add `server_mode` flag to desktop**
   - When enabled, `begin_session` sends `Request::Subscribe` to server
   - When disabled, use existing direct-agent mode (fallback)

3. **Wire session list to server**
   - `list_sessions` should query server (`GetHistory` / `GetState`) or read from disk consistently
   - Server-side sessions must appear in desktop sidebar

4. **Ensure swarm events flow correctly**
   - Server emits `SwarmStatus`, `SwarmPlan`, `Notification` → desktop receives via socket → Tauri emits → reducer handles

### P1: Team Operational Console (UI/UX)

1. **Redesign TeamPage as control panel**
   - Add operational buttons per agent: Stop, Restart, DM, Read Context
   - Add team-level controls: Spawn, Broadcast, Run Plan, Cleanup
   - Add plan proposal actions: Approve, Reject, View Diff

2. **Add task assignment UI**
   - List plan items with status
   - Click to assign to agent
   - Show in-flight tasks with progress

3. **Add channel UI**
   - Sidebar channel list
   - Channel message thread
   - Subscribe/unsubscribe

4. **Improve plan visualization**
   - Replace stat cards with a DAG list or simple graph
   - Show dependencies, blockers, assigned owner

### P2: Agent Lifecycle Deep UI

1. **Rich agent cards**
   - Full lifecycle state (not just ready/working)
   - Current tool call with intent
   - Last completion report preview
   - Files touched
   - Model/provider badge

2. **Notification center**
   - `Notification` events (file conflicts, DMs)
   - Toast/inline alerts
   - Actionable buttons ("Resolve conflict", "View diff")

3. **Activity feed**
   - Chronological feed of tool calls, plan updates, lifecycle changes
   - Filter by agent, by type

### P3: Polish

1. **Server connection status indicator**
   - Show daemon connection state
   - Auto-reconnect with backoff
   - Reconnect to sessions after restart

2. **Worktree visualization**
   - If worktrees are used, show grouping
   - Changed files per worktree
   - Integration/merge status

3. **Keyboard shortcuts**
   - Quick spawn agent
   - Quick broadcast
   - Navigation between agents

---

## 5. Risk Assessment

| Risk | Mitigation |
|------|------------|
| **Tauri → Server protocol is large** | Start with a subset: subscribe, message, spawn, stop, list, plan status. Add others incrementally. |
| **Server may not be running** | Auto-spawn daemon on desktop launch (same logic as TUI). Show "Starting server..." splash. |
| **Dual mode complexity** | Keep direct-agent as fallback behind a flag. Default to server mode. Remove fallback once server mode is stable. |
| **Event ordering / state sync** | Server events are append-only with session_id. Frontend reducer already handles this well. Add event cursor for resumable subscriptions. |
| **Performance with many agents** | Server already handles this. Desktop virtualizes lists. Should be fine. |

---

## 6. Conclusion

The jcode desktop app has **excellent UI foundations** for an Agent Team console — workspace model, virtual thread, presence indicators, and plan display are all well-built. The missing piece is **architectural alignment**: the desktop must speak the same protocol as the TUI and the agent `communicate` tool.

**Recommended immediate next step:** Implement a Tauri-side server socket client and expose a minimal set of `comm_*` commands to the frontend. Wire the existing `TeamPage` to actually call `comm_spawn`, `comm_stop`, and `comm_assign_task`. This turns the current dashboard into a real control surface with ~2 weeks of focused work.

The longer-term goal (server-backed session lifecycle) is a larger project (~4-6 weeks) but is the only path to a truly integrated Agent Team GUI that works seamlessly with the TUI and CLI.
