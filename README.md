# Harness

Harness is a terminal-native control plane for agentic coding on your local machine.

Run many agent threads in parallel across `codex`, `claude`, `cursor`, `terminal`, and `critique`, while keeping each thread in project context with one fast TUI and one typed realtime API.

## What You Can Do

- Run many agent threads in parallel across `codex`, `claude`, `cursor`, `terminal`, and `critique`.
- Keep native CLI ergonomics in one keyboard-first workspace.
- Jump between threads in milliseconds, with 400+ FPS rendering under local workloads.
- Use `critique` threads for fast diff/review loops with direct terminal access.
- Keep long-running threads alive in a detached gateway so reconnects do not kill work.
- Plan and pull scoped tasks (`project`, `repository`, `global`) from one place.
- Automate through a typed realtime API when you want orchestration.

## Demo

![Harness multi-thread recording](assets/poem-recording.gif)

## Quick Start

### Prerequisites

- Bun `1.3.9+`
- Rust toolchain (used for the PTY helper; `bun install` auto-installs via `rustup` if missing)
- At least one agent CLI you plan to use (`codex`, `claude`, `cursor`, or `critique`)

### Install and Run

```bash
bun install
bun link
harness
```

Harness connects to the current gateway session (or starts it in the background).

Use an isolated named session when you want separate state:

```bash
harness --session perf-a
```

## Critique Support

Harness includes first-class `critique` threads:

- Available in the New Thread modal.
- Runs with `--watch` by default.
- Auto-install path enabled by default via `bunx critique@latest` when `critique` is not installed.
- `mux.conversation.critique.open-or-create` is bound to `ctrl+g` by default.

`ctrl+g` behavior is project-aware:

- If a critique thread exists for the current project, it selects it.
- If not, it creates and opens one in the main pane.

## Configuration

Runtime behavior is config-first via `harness.config.jsonc`.

Example (critique defaults + hotkey override + OpenCode theme selection):

```jsonc
{
  "critique": {
    "launch": {
      "defaultArgs": ["--watch"]
    },
    "install": {
      "autoInstall": true,
      "package": "critique@latest"
    }
  },
  "mux": {
    "ui": {
      "theme": {
        "preset": "tokyonight",
        "mode": "dark",
        "customThemePath": null
      }
    },
    "keybindings": {
      "mux.conversation.critique.open-or-create": ["ctrl+g"]
    }
  }
}
```

`mux.ui.theme.customThemePath` can point to any local JSON file that follows the OpenCode theme schema (`https://opencode.ai/theme.json`).

## Documentation

- `design.md` for architecture and system design principles.
- `agents.md` for execution and quality rules.

## License

MIT (`LICENSE`)
