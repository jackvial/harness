# Harness

Harness is a terminal-native workspace for running parallel coding agents on one machine, with project context, fast switching, and shared session state.

Use it when you want to move faster than a single chat window: keep multiple threads active, review diffs quickly, and drive work from one keyboard-first control plane.

## Why teams use it

- Run multiple threads in parallel (`codex`, `claude`, `cursor`, `terminal`, `critique`).
- Keep work scoped to the right project/repo context.
- Reconnect without losing long-running sessions.
- Move quickly between implementation and review loops.
- Open repo/PR actions directly from the same workflow.

## Demo

![Harness multi-thread recording](assets/poem-recording.gif)

## Quick start

### Prerequisites

- Bun `1.3.9+`
- Rust toolchain
- At least one installed agent CLI (`codex`, `claude`, `cursor`, or `critique`)

### Install

```bash
bun install
bun link
```

### Run

```bash
harness
```

Use a named session when you want isolated state:

```bash
harness --session my-session
```

## Common workflow

1. Open Harness in your repo.
2. Start parallel threads for implementation and review.
3. Use the command palette (`ctrl+p` / `cmd+p`) to jump, run actions, and manage project context.
4. Open the repo or PR actions from inside Harness when GitHub auth is available.

## Configuration

Harness is config-first via `harness.config.jsonc` and bootstraps it automatically on first run.

## Documentation

- `design.md` contains architecture and system design.
- `agents.md` contains execution and quality rules.

## License

MIT (`LICENSE`)
