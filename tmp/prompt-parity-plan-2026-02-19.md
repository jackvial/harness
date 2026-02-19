# Prompt Parity Plan (codex + claude + cursor)

Date: 2026-02-19
Status: Draft for review before implementation

## Objective
Deliver prompt-capture parity across all three wrapped agents (`codex`, `claude`, `cursor`) with one extensible abstraction that uses the same event path style as session status/status-line updates. Focus first on **prompt accuracy** (including mid-conversation prompts), then route prompt events into thread updates driven by our Anthropic integration.

## Non-goals (this phase)
- No attempt to fully model all tool/lifecycle semantics beyond what prompt capture needs.
- No broad UI redesign.
- No provider-specific “magic” outside clear adapters.

## Recommendation Summary
Use a **unified session signal abstraction** with prompt as a first-class signal, while keeping backward compatibility for existing `session-key-event`/status consumers.

Why this path:
- Reuses the same control-plane observed-event fanout pattern already used by status.
- Avoids overloading status reducers with prompt payload concerns.
- Makes it straightforward to add future signal kinds (tool call, diff update, approvals).

## Architecture Plan

### 1) Introduce canonical prompt signal types (protocol layer)
Add typed prompt payloads to stream protocol and parsing:
- New prompt content model:
  - `text` (nullable)
  - `hash` (stable sha256)
  - `confidence` (`high|medium|low`)
  - `captureSource` (`otlp-log|hook-notify|history`)
  - `providerEventName`
  - `providerPayloadKeys` (small key list for forensic debugging)
- New observed event:
  - `type: 'session-prompt-event'`
  - includes `sessionId`, `directoryId`, `conversationId`, `prompt`, `ts`

Primary files:
- `src/control-plane/stream-protocol.ts`
- `test/control-plane-stream-protocol.test.ts`
- `test/control-plane-stream-protocol-server-errors.test.ts`

Compatibility rule:
- Keep current `session-key-event` unchanged for status/lifecycle behavior.

### 2) Build a prompt extraction abstraction (same level as status engine)
Add a new engine parallel to status reducers:
- `SessionPromptEngine` with provider adapters:
  - `codex` adapter
  - `claude` adapter
  - `cursor` adapter
- Input: agent type + raw notify/telemetry/history context
- Output: canonical prompt signal (or `null`)

Primary files (new):
- `src/control-plane/prompt/session-prompt-engine.ts`
- `src/control-plane/prompt/agent-prompt-extractor.ts`
- `src/control-plane/prompt/extractors/codex-prompt-extractor.ts`
- `src/control-plane/prompt/extractors/claude-prompt-extractor.ts`
- `src/control-plane/prompt/extractors/cursor-prompt-extractor.ts`

Tests:
- `test/control-plane-prompt-engine.test.ts`
- property tests similar to `test/property-runtime-store.test.ts`

### 3) Wire extraction into runtime ingestion (single source of truth path)
Emit `session-prompt-event` from the same runtime handling path that already publishes status/key events.

Integration points:
- `src/control-plane/stream-server-session-runtime.ts`
  - extend notify handling to call `SessionPromptEngine`
- `src/control-plane/stream-server.ts`
  - publish new observed prompt event

Rule:
- Prompt event emission is independent of status hint mapping to avoid missed prompts.

### 4) Agent-specific accuracy strategy

#### Codex
- Keep existing telemetry/key-event behavior for status.
- For prompt text accuracy:
  - Prefer prompt text from full OTLP log payload when available.
  - If telemetry ingest mode is `lifecycle-fast`, backfill from Codex history events (`user_prompt`) for prompt text.
- Never infer prompt text from status summary alone.

#### Claude
- Extract prompt text from `UserPromptSubmit` notify payload (`prompt` plus known fallback keys).
- Preserve confidence metadata and payload-key provenance.

#### Cursor
- Extract prompt text from `beforeSubmitPrompt` payload keys when present.
- Keep confidence lower when payload lacks explicit prompt text.
- Preserve event emission even when prompt text is null so turn boundaries remain accurate.

### 5) Mid-conversation prompt correctness guarantees
Implement dedupe and ordering that preserve repeated prompts:
- Deduplicate by `(sessionId, promptHash, observedAt-second bucket, providerEventName)`.
- Do **not** dedupe by only event type (avoids dropping rapid consecutive prompts).
- Keep strict observed-at ordering per session.

Regression tests:
- Multiple prompts in one session in short intervals.
- Edit-and-resubmit style prompt bursts.
- Reconnect/resume cases for all 3 agents.

### 6) Thread update integration hook (Anthropic-ready, accuracy-first)
Add a subscriber/service that consumes `session-prompt-event` and updates thread metadata via existing control-plane thread API, with optional Anthropic enrichment.

Phase-1 behavior:
- Persist latest accurate prompt per thread.
- Queue optional AI enrichment job (feature-flagged) for title/summary updates.

Primary files:
- `scripts/codex-live-mux-runtime.ts` (stream event handling hook)
- new service (suggested): `src/services/runtime-thread-prompt-updater.ts`
- `src/services/control-plane.ts` (reuse `updateConversationTitle` + thread APIs as needed)

### 7) Config and safety controls
Add config-first controls (no env-only behavior):
- `promptCapture.enabled`
- `promptCapture.codex.allowHistoryBackfill`
- `promptCapture.cursor.allowNullPromptEvents`
- `threadIntelligence.enabled`
- `threadIntelligence.anthropic.model`
- `threadIntelligence.debounceMs`

Files:
- `src/config/config-core.ts`
- `src/config/harness.config.template.jsonc`
- config tests in `test/`

## Implementation Sequence (recommended)
1. Protocol additions + parser tests.
2. `SessionPromptEngine` + unit/property tests.
3. Runtime emission of `session-prompt-event`.
4. Agent-specific extraction hardening + mid-conversation regression suite.
5. Runtime thread prompt updater (without AI generation first).
6. Anthropic enrichment wiring behind feature flag.
7. End-to-end validation and coverage/lint gates.

## Acceptance Criteria
- Prompt events emitted for all three agents on first and subsequent prompts in a single conversation.
- Mid-conversation prompt sequences are preserved in order with no dropped events.
- Status/status-line behavior is unchanged (no regression in existing status tests).
- Prompt payload confidence/source is populated and test-verified.
- Feature-flag off => no prompt/thread side effects.
- Bun test/lint/coverage remain green at project gates.

## Alternatives Considered

### A) Extend `session-key-event` with prompt payload only
Pros: least protocol surface.
Cons: conflates status telemetry with high-value prompt data; harder to evolve for other signal kinds.

### B) Raw notify-only client parsing
Pros: minimal backend work.
Cons: every client must implement per-agent parsing; weak parity and maintainability.

### C) Durable-artifact polling only
Pros: completeness.
Cons: latency; misses immediate UX expectations.

Chosen: **hybrid unified signal path** (new `session-prompt-event` + existing raw notify + backfill where needed).

## Risks and Mitigations
- Cursor payload variability: keep null-text prompt events + confidence metadata.
- Codex lifecycle-fast hiding text: history backfill and/or configurable full ingest mode.
- Duplicate prompt bursts: hash + timestamp-bucket dedupe with tests.
- Performance drift: keep extraction lightweight; avoid deep payload scans on hot path.
