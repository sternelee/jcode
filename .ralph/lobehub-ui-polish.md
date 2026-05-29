# LobeHub UI Polish — Multiple Iterations

Polish all remaining jcode-app UI components to match LobeHub's design language.

## Current status
- ✅ App.css — LobeHub theme (blue palette, CSS variables)
- ✅ NavBar — Clean icon bar
- ✅ ConversationsList — Clean sidebar
- ✅ ChatArea — LobeHub-style chat
- ✅ MessageBubble — Clean bubbles
- ✅ SlashCommands/CreateSessionDialog — Colors fixed

## Todo (each iteration handles 2-3 items)
1. ConfirmDialog + StdinInputModal → LobeHub style
2. SessionSwitcherDialog → LobeHub style
3. SettingsPage → LobeHub settings layout, use new CSS vars
4. ProviderConfigPage → LobeHub provider config
5. Swarm UI polish (ChatArea swarm mode, SessionSidebar)
6. Final visual consistency pass

## Guidelines
- Use semantic Tailwind v4 classes (bg-card, border-border, text-foreground, bg-primary etc.)
- No hardcoded hex colors
- LobeHub look: clean cards, subtle shadows, blue accent, rounded corners
- Keep all backend logic intact — this is purely visual
- After each file, run `npx tsc --noEmit` to verify TypeScript
