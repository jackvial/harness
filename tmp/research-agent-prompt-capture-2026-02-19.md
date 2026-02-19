# Research: Prompt Capture Across Wrapped Agents (2026-02-19)

## Goal
Determine the most reliable way for `harness` to capture **all user prompts** across supported wrapped agents and make them subscribable in real time.

## Scope and Revisions
- `harness-4` workspace (local)
- SpecStory CLI commit `56cbc6a` (`specstoryai/getspecstory`, branch `dev`)
- Entire CLI commit `cef002c` (`entireio/cli`, branch `main`)

## What `harness` Supports Today
- Interactive wrapped agents: `codex`, `claude`, `cursor` (`src/control-plane/stream-server.ts:426`)
- `stream.subscribe` exists for observed-event fanout (`src/control-plane/stream-protocol.ts:352`, `src/control-plane/stream-server-command.ts:2184`)
- `pty.subscribe-events` exists for raw PTY session events (`src/control-plane/stream-server-command.ts:2541`)

## Current Prompt Data Paths in `harness`

### 1) Real-time raw notify payloads already flow through subscriptions
- Notify payload type is open-ended (`Record<string, unknown>`) (`src/control-plane/stream-protocol.ts:569`)
- `session-event` carries `StreamSessionEvent` (including `notify.record.payload`) to `stream.subscribe` subscribers (`src/control-plane/stream-protocol.ts:696`)
- PTY event subscribers also receive raw mapped notify event (`src/control-plane/stream-server-session-runtime.ts:530`)

Implication: a subscriber can already receive provider-native hook payloads if it listens to `session-event`/`pty.event`.

### 2) `harness` normalizes lifecycle signals but mostly drops prompt text
- `handleInput` writes bytes to PTY, no semantic prompt extraction (`src/control-plane/stream-server-session-runtime.ts:226`)
- Notify mapping to session-key events:
  - Cursor `beforeSubmitPrompt` -> `cursor.beforesubmitprompt` (`src/control-plane/stream-server-session-runtime.ts:364`)
  - Claude `UserPromptSubmit` -> `claude.userpromptsubmit` (`src/control-plane/stream-server-session-runtime.ts:422`)
  - Codex notify mapping currently focused on completion status (`src/control-plane/stream-server-session-runtime.ts:306`)
- Lifecycle hook normalization uses these names for `turn.started` (`src/control-plane/lifecycle-hooks.ts:570`)

### 3) Codex can include prompt text, but mode matters
- Launch config sets `otel.log_user_prompt` (`src/control-plane/codex-telemetry.ts:1261`, `src/control-plane/stream-server.ts:1440`)
- Full OTLP parser can summarize `codex.user_prompt` as `prompt: <text>` (`src/control-plane/codex-telemetry.ts:568`)
- Lifecycle-fast parser intentionally compresses this to `prompt submitted` (`src/control-plane/codex-telemetry.ts:946`)
- Runtime picks lifecycle-fast when configured (`src/control-plane/stream-server.ts:1851`)
- History fallback exists (`~/.codex/history.jsonl`) (`src/control-plane/stream-server.ts:557`, `src/control-plane/stream-server-background.ts:193`, `src/control-plane/codex-telemetry.ts:1325`)

### 4) Hook relay installation exists for Claude and Cursor
- Claude launch injects hooks (`UserPromptSubmit`, `PreToolUse`, `Stop`, `Notification`) via `--settings` (`src/control-plane/stream-server.ts:1468`)
- Cursor managed hooks include `beforeSubmitPrompt` + tool/stop hooks (`src/cursor/managed-hooks.ts:9`)
- Cursor relay writes hook stdin JSON into notify file (with session metadata) (`scripts/cursor-hook-relay.ts:45`)
- Claude default relay path currently points to `scripts/codex-notify-relay.ts` (`src/control-plane/stream-server.ts:422`) which is generic JSON passthrough (`scripts/codex-notify-relay.ts:26`)

## SpecStory: How It Gets “Real” Prompt Data

## Core pattern
SpecStory does **not** depend on terminal input interception for truth. It launches agent CLIs and watches each provider’s native persisted artifacts.

- Provider interface explicitly requires `ExecAgentAndWatch` + `WatchAgent` (`/tmp/specstory-cli-inspect/specstory-cli/pkg/spi/provider.go:77`)
- `run` command calls `provider.ExecAgentAndWatch(...)` (`/tmp/specstory-cli-inspect/specstory-cli/main.go:452`)
- Provider storage map is explicit:
  - Claude JSONL
  - Cursor SQLite `store.db`
  - Codex JSONL
  - Gemini JSON
  (`/tmp/specstory-cli-inspect/specstory-cli/docs/PROVIDER-SPI.md:11`)

## Wrap mechanics
- Example provider launch is pass-through stdio (`cmd.Stdin/Stdout/Stderr = os.Stdin/Stdout/Stderr`) (`/tmp/specstory-cli-inspect/specstory-cli/pkg/providers/claudecode/claude_code_exec.go:112`)
- Real-time updates come from file/database watchers:
  - Claude `.jsonl` create/write watcher (`.../claudecode/watcher.go:221`)
  - Cursor record-count polling in SQLite `blobs` table (WAL-aware) (`.../cursorcli/watcher.go:223`)
  - Codex session-dir watcher (`.../codexcli/watcher.go:78`)
  - Gemini chats directory watcher + multi-file merge (`.../geminicli/watcher.go:144`, `.../geminicli/json_parser.go:210`)

## Prompt extraction specifics
- Codex: `event_msg.payload.type == user_message`, text from `payload.message` (`.../codexcli/agent_session.go:217`)
- Cursor: user role blobs, remove `<user_query>...</user_query>`, skip `<user_info>` metadata (`.../cursorcli/agent_session.go:112`, `.../cursorcli/agent_session.go:534`)
- Claude: parse JSONL DAG, user entries become new exchange starts (`.../claudecode/agent_session.go:119`)
- Gemini: user messages from `messages[].type == "user"` with robust content decoding (`.../geminicli/json_parser.go:69`)

## Entire: How It Gets “Real” Prompt Data

## Core pattern
Entire is primarily **hook-driven**, with transcript analysis for durability/enrichment.

- Hidden internal hook command tree: `entire hooks ...` (`/tmp/entireio-cli-inspect/cmd/entire/cli/hooks_cmd.go:14`)
- Agent hook registration is dynamic per agent handler (`/tmp/entireio-cli-inspect/cmd/entire/cli/hook_registry.go:49`)
- Current wired agents in this repo: Claude + Gemini (`/tmp/entireio-cli-inspect/cmd/entire/cli/hooks_cmd.go:6`)

## Hook installation specifics
- Claude install adds `entire hooks claude-code user-prompt-submit` and related hooks (`/tmp/entireio-cli-inspect/cmd/entire/cli/agent/claudecode/hooks.go:145`)
- Gemini install enables `hooksConfig.Enabled = true` and installs `entire hooks gemini ...` (`/tmp/entireio-cli-inspect/cmd/entire/cli/agent/geminicli/hooks.go:111`)

## Prompt extraction specifics
- Claude `UserPromptSubmit` payload struct includes `prompt` (`/tmp/entireio-cli-inspect/cmd/entire/cli/agent/claudecode/types.go:40`)
- Claude lifecycle parse sets normalized `Event.Prompt` on `TurnStart` (`/tmp/entireio-cli-inspect/cmd/entire/cli/agent/claudecode/lifecycle.go:147`)
- Gemini `BeforeAgent` payload includes `prompt` (`/tmp/entireio-cli-inspect/cmd/entire/cli/agent/geminicli/types.go:57`)
- Gemini lifecycle parse sets normalized `Event.Prompt` on `TurnStart` (`/tmp/entireio-cli-inspect/cmd/entire/cli/agent/geminicli/lifecycle.go:107`)
- Normalized agent event has explicit `Prompt` field (`/tmp/entireio-cli-inspect/cmd/entire/cli/agent/event.go:77`)

## Transcript durability path
- On lifecycle handling, Entire copies transcript and then extracts prompts from offsets (`/tmp/entireio-cli-inspect/cmd/entire/cli/lifecycle.go:198`, `/tmp/entireio-cli-inspect/cmd/entire/cli/lifecycle.go:230`)
- It persists extracted prompt list to prompt file (`/tmp/entireio-cli-inspect/cmd/entire/cli/lifecycle.go:265`)
- Transcript extraction methods are agent-specific (`.../agent/claudecode/lifecycle.go:66`, `.../agent/geminicli/lifecycle.go:56`)

## Recommended Approach for `harness`

Adopt a **hybrid model**:
1. **Hook/telemetry-first real-time prompt capture** for low-latency prompt events.
2. **Durable artifact backfill** (history/transcript/db polling) for completeness and recovery.
3. **Canonical prompt event contract** so subscribers do not parse provider-specific payloads.

### Canonical contract (proposed)
Emit a new observed event type, e.g. `session-prompt`, with:
- `sessionId`
- `agentType` (`codex|claude|cursor`)
- `providerEventName` (e.g. `codex.user_prompt`, `claude.userpromptsubmit`, `cursor.beforesubmitprompt`)
- `promptText` (nullable)
- `promptHash` (stable hash for dedupe/audit)
- `source` (`otlp-log|hook-notify|history|transcript|sqlite`)
- `observedAt`
- `cursor` (stream cursor)

### Agent-specific capture plan
- Codex:
  - Keep `otel.log_user_prompt=true`.
  - Parse prompt text from full OTLP logs when available.
  - If lifecycle-fast is required for performance, keep history poll fallback active and parse user prompt entries from history.
- Claude:
  - Parse `prompt` directly from `UserPromptSubmit` hook payload in notify mapper.
  - Preserve raw payload in `session-event` for forensic/debug parity.
- Cursor:
  - Parse prompt field from `beforeSubmitPrompt` payload if present.
  - Keep raw payload pass-through for future schema changes.
  - Optional durability fallback: Cursor native sqlite transcript parsing if hook payload does not contain prompt text.

### Subscription recommendation
- Keep existing `stream.subscribe` and add optional prompt-focused filtering (e.g. `eventTypes: ["session-prompt"]`).
- Continue to expose raw provider payloads via `session-event` for advanced clients.

## Alternatives and Tradeoffs

1. Raw notify only (no canonical prompt event)
- Pros: minimal code, immediate access.
- Cons: every client reimplements provider parsing; brittle to schema drift.

2. PTY input interception only
- Pros: provider-agnostic in theory.
- Cons: misses semantic boundaries, multi-line editing details, non-enter submits, resumed sessions; not authoritative.

3. Durable storage polling only (SpecStory style)
- Pros: high completeness, replayability.
- Cons: higher latency, parser complexity per provider, heavier IO.

4. Hook/telemetry only (Entire style, no backfill)
- Pros: lowest latency and cleaner semantics.
- Cons: loses completeness during hook failures, crashes, or config drift.

5. Hybrid (recommended)
- Pros: best balance of latency + completeness + resilience.
- Cons: more implementation surface (requires dedupe and precedence rules).

## Concrete Recommendation
Implement option 5 (hybrid), with precedence:
1. Hook/OTLP prompt text when present.
2. History/transcript/sqlite backfill if missing.
3. Deduplicate by `(sessionId, promptHash, timestamp bucket)` and retain source provenance.

This matches the strongest qualities of both products:
- SpecStory’s durable native-artifact truth model.
- Entire’s low-latency hook semantics and normalized prompt field.

