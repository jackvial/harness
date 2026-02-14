# harness

Terminal-first multi-agent harness focused on low-latency human control, with agent/API parity over the same control plane.

## Core Documents
- `design.md`: living architecture and principles.
- `agents.md`: living execution and quality laws.

## Current Verified Baseline
- PTY passthrough with vim-grade parity checks.
- Single-session attach/detach/reconnect broker.
- Latency benchmark gate with p50/p95/p99 overhead checks.
- Codex live-session checkpoint: PTY-hosted `codex` with notify-hook event ingestion and persisted normalized stream output.
- Stream isolation checkpoint: PTY bytes stay in the terminal stream; events are out-of-band in SQLite/event views.
- Deterministic pseudo-snapshot oracle for integration/e2e (`rows`, `cols`, `activeScreen`, `cursor`, `lines`, `frameHash`).
- Scroll-region/origin-mode terminal correctness for pinned-footer UIs (`DECSTBM`, `DECOM`, `IND`/`NEL`/`RI`, `IL`/`DL`).
- Programmatic parity matrix runner for codex/vim/core scenes (`npm run terminal:parity`).

## Priority Direction
- Primary: self-hosted live-steered Codex PTY session.
- Secondary: programmatic steering parity over the same stream API.
- Enrichment: notify event channels layered on top, never replacing live session authority.

## Commands
- `npm run verify`
- `npm run vim:passthrough`
- `npm run benchmark:latency`
- `npm run codex:live -- <codex-args>`
- `npm run codex:live:mux -- <codex-args>` (first-party split: live session + event feed)
- `npm run codex:live:tail -- --conversation-id <id> [--from-now] [--only-notify] [--include-text-deltas]`
- `npm run codex:live:snapshot -- --conversation-id <id> [--follow] [--from-now] [--json]`
- `npm run terminal:parity [-- --json]`

## License
- `UNLICENSE`
