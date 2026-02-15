# harness

```text
██╗  ██╗ █████╗ ██████╗ ███╗   ██╗███████╗███████╗███████╗
██║  ██║██╔══██╗██╔══██╗████╗  ██║██╔════╝██╔════╝██╔════╝
███████║███████║██████╔╝██╔██╗ ██║█████╗  ███████╗███████╗
██╔══██║██╔══██║██╔══██╗██║╚██╗██║██╔══╝  ╚════██║╚════██║
██║  ██║██║  ██║██║  ██║██║ ╚████║███████╗███████║███████║
╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝╚══════╝╚══════╝

terminal-first control for many live coding agents
```

Harness is a high-performance TUI control plane for running and steering multiple coding agents with terminal parity.

## Demo

![Harness multi-conversation recording](assets/poem-recording.gif)

This recording shows three separate Codex sessions running in parallel, with live switching between conversations while each session continues working. The GIF is generated from Harness frame-buffer recording, not screen capture.

## Current Capabilities

- Host real agent CLIs inside first-party PTY sessions with live human steering.
- Run multiple threads concurrently and switch active control instantly.
- Persist project/thread metadata across reconnects via the control-plane SQLite state store.
- Persist adapter state required for provider-native thread continuity (Codex resume path).
- Capture Codex observability data end-to-end (OTLP logs/metrics/traces + `~/.codex/history.jsonl`) into the control-plane SQLite store for durable session diagnostics and richer runtime state.
- Stream typed key status/telemetry events from the control plane (`session-status` + `session-key-event`) through a reusable internal subscription API for UI consumers.
- Normalize provider/control-plane lifecycle transitions into one hook event model (`thread.*`, `session.*`, `turn.*`, `tool.*`, `input.required`) for automation and notification adapters.
- Dispatch lifecycle hooks from config (`harness.config.jsonc`) with connector adapters (`peon-ping` sound categories and generic outbound webhooks).
- Keep startup focused on the selected conversation by default; persisted non-selected conversations are not auto-resumed unless explicitly enabled.
- Show a project-scoped left rail with thread status, git summary, and per-session telemetry.
- Drive thread bubble state and second-line "last known work" text from control-plane key events instead of local input heuristics.
- Normalize actionable session states for operators (`working`, `needs action`, `idle`, `complete`, `exited`).
- Support keyboard and mouse-driven thread selection in the mux.
- Support keyboard and clickable left-rail actions for new thread, archive thread, add project, and close project.
- Create new threads through a modal chooser (`codex` or `terminal`) and launch terminal threads as plain shells under the same control-plane session model.
- Select projects directly from the rail to open a project-focused pane (tree preview) and scope project actions explicitly.
- Scope `new thread`/`close project` to the selected project in project view, while thread selection keeps `new thread` in that thread's project.
- Soft-delete threads in the mux by archiving them; permanent delete remains a control-plane API command.
- Add and close projects from the mux without leaving the TUI.
- Render prompt workflows (directory add, title edit) as immediate-mode modal overlays built from first-party UI-kit primitives.
- Drag the pane divider to resize rail/content width interactively.
- Keep one protocol path for both human UI and API clients through the control-plane stream.
- Prioritize interactive control actions over background warm-start work so switching and selection stay responsive under multi-session load.
- Keep PTY/event subscriptions scoped to the active conversation and reattach with cursor continuity to avoid replay storms on conversation switches.
- Keep process-usage probing opt-in (`HARNESS_MUX_BACKGROUND_PROBES=1`) while Git status runs through an adaptive per-project scheduler (`mux.git.*` in `harness.config.jsonc`) to stay fresh without spiking resources.
- Expose stream subscriptions with scoped replay for automation clients monitoring live session state/output.
- Ship a public TypeScript realtime client (`HarnessAgentRealtimeClient`) for external automation adapters with typed event handlers and command wrappers.
- Support explicit session ownership semantics (`session.claim`/`session.release`) including takeover handoff so humans and agents can coordinate control safely.
- Record terminal frames and export deterministic GIF artifacts.
- Measure startup repeatably with loop tooling (`perf:codex:startup:loop`) and mux `perf-core` timeline reports (`perf:mux:startup`).
- Compare direct Codex startup versus `codex:live:mux:launch` through first output, first paint, and settled (`mux.startup.active-settled`) with one `perf-core` stream (`perf:mux:launch:startup:loop`).
- Render a visual startup timeline report (`perf:mux:startup`) that includes launch/daemon/mux/client/server negotiation checkpoints and terminal-query handled/unhandled cataloging.
- Run a deterministic no-Codex startup paint probe through the same mux client/server path (`mux:fixture:launch`) to isolate harness rendering/protocol overhead.
- Run a standalone mux hot-path micro-harness (`perf:mux:hotpath`) that isolates VTE parse, snapshot/hash, row render/diff, protocol roundtrip, and input-delay behavior without Codex or the control-plane daemon.
- Capture terminal startup-query handling (`codex.terminal-query`) to identify unanswered protocol probes.
- Codex startup loop supports readiness pattern timing (`--ready-pattern "Tip: ..."`) in addition to first output/paint.

## Performance Loop

Use the standalone hot-path harness to reproduce latency/FPS pressure with deterministic synthetic output and no daemon/PTY/Codex startup noise:

```bash
npm run perf:mux:hotpath -- --duration-ms 6000 --output-hz 140 --bytes-per-chunk 320 --sessions 2 --parse-passes 2 --profile mixed
```

Run the built-in diagnostic matrix to A/B the main hot-path suspects:

```bash
npm run perf:mux:hotpath -- --matrix --duration-ms 4000
```

Key toggles:
- `--parse-passes`: simulate single/double/triple `TerminalSnapshotOracle` ingest cost.
- `--protocol-roundtrip`: include base64+JSON encode/decode overhead per output chunk.
- `--snapshot-hash`: include per-render full-frame hash work (disabled by default to match mux hot-path optimization).
- `--recording-snapshot-pass`: include an extra snapshot/hash pass to model recording overhead.
- `--fixture-file <path>`: replay deterministic bytes from a local file instead of synthetic chunks.
- `harness.config.jsonc` -> `debug.mux.serverSnapshotModelEnabled`: controls whether the server-side live-session snapshot model ingests PTY output (`true` default). Keep this in config, not env, when profiling server/client duplicate-parse cost.

## Technical Strategy

- First-party latency-critical path: PTY host, terminal model, renderer, mux input routing.
- Strict typed TypeScript + Rust PTY sidecar where it matters.
- Stream protocol as the primary interface for control and observability.
- SQLite append-only events store for persistent, tenanted state.
- One config system (`harness.config.jsonc`), one logger, one perf instrumentation surface.
- Lifecycle hook behavior is config-first (`hooks.lifecycle.*`): provider filters, connector enablement, event filters, and connector-specific settings are all file-governed.
- Debug/perf knobs live in `harness.config.jsonc` (`debug.*`) with overwrite-on-start artifact control.
- Mux Git freshness controls are config-first (`mux.git.*`) with active/idle/burst poll tuning and bounded concurrency.
- Verification gates are mandatory: lint, typecheck, dead-code checks, and full coverage.

## Spirit

- Human-first operation with full pass-through terminal feel.
- Agent parity by design: anything a human can do should be scriptable through the same control plane.
- Minimal, functional, beautiful interfaces over heavyweight desktop UI stacks.
- Reproducible behavior over vibes: measurable latency, deterministic rendering, explicit state.

## Core Docs

- `design.md` for architecture and system principles.
- `agents.md` for execution laws and quality rules.

## License

MIT (`LICENSE`)
