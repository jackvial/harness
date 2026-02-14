import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

interface DualOptions {
  codexArgs: string[];
  conversationId: string;
  turnId: string;
  tenantId: string;
  userId: string;
  workspaceId: string;
  worktreeId: string;
  dbPath: string;
  sessionName: string;
  debug: boolean;
  captureDir: string | null;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function runTmux(args: string[]): void {
  const result = spawnSync('tmux', args, { stdio: 'inherit' });
  if (result.status === 0) {
    return;
  }
  const code = result.status ?? 1;
  throw new Error(`tmux command failed (exit ${String(code)}): tmux ${args.join(' ')}`);
}

function tmuxAvailable(): boolean {
  const result = spawnSync('tmux', ['-V'], { stdio: 'ignore' });
  return result.status === 0;
}

function parseArgs(argv: string[]): DualOptions {
  const conversationId = process.env.HARNESS_CONVERSATION_ID ?? `conversation-${randomUUID()}`;
  const turnId = process.env.HARNESS_TURN_ID ?? `turn-${randomUUID()}`;
  const tenantId = process.env.HARNESS_TENANT_ID ?? 'tenant-local';
  const userId = process.env.HARNESS_USER_ID ?? 'user-local';
  const workspaceId = process.env.HARNESS_WORKSPACE_ID ?? 'workspace-local';
  const worktreeId = process.env.HARNESS_WORKTREE_ID ?? 'worktree-local';
  const dbPath = process.env.HARNESS_EVENTS_DB_PATH ?? '.harness/events.sqlite';
  const suffix = conversationId.slice(-8).replaceAll(/[^a-zA-Z0-9]/g, 'x');
  const sessionName = process.env.HARNESS_TMUX_SESSION_NAME ?? `harness-codex-${suffix}`;
  const debug = process.env.HARNESS_TMUX_DEBUG === '1';
  const captureDir = process.env.HARNESS_TMUX_CAPTURE_DIR ?? (debug ? '.harness/tmux-capture' : null);

  return {
    codexArgs: argv,
    conversationId,
    turnId,
    tenantId,
    userId,
    workspaceId,
    worktreeId,
    dbPath,
    sessionName,
    debug,
    captureDir
  };
}

function buildEnvPrefix(options: DualOptions): string {
  const envEntries: Array<[string, string]> = [
    ['HARNESS_CONVERSATION_ID', options.conversationId],
    ['HARNESS_TURN_ID', options.turnId],
    ['HARNESS_TENANT_ID', options.tenantId],
    ['HARNESS_USER_ID', options.userId],
    ['HARNESS_WORKSPACE_ID', options.workspaceId],
    ['HARNESS_WORKTREE_ID', options.worktreeId],
    ['HARNESS_EVENTS_DB_PATH', options.dbPath]
  ];

  return envEntries
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(' ');
}

function buildLiveCommand(options: DualOptions): string {
  const envPrefix = buildEnvPrefix(options);
  const liveScriptPath = resolve(process.cwd(), 'scripts/codex-live.ts');
  const commandParts = [
    shellQuote(process.execPath),
    '--experimental-strip-types',
    shellQuote(liveScriptPath),
    ...options.codexArgs.map((arg) => shellQuote(arg))
  ];
  return `${envPrefix} ${commandParts.join(' ')}`;
}

function buildTailCommand(options: DualOptions): string {
  const envPrefix = buildEnvPrefix(options);
  const tailScriptPath = resolve(process.cwd(), 'scripts/codex-live-tail.ts');
  const commandParts = [
    shellQuote(process.execPath),
    '--experimental-strip-types',
    shellQuote(tailScriptPath),
    '--conversation-id',
    shellQuote(options.conversationId),
    '--from-now',
    '--no-exit-on-session-end'
  ];
  return `${envPrefix} ${commandParts.join(' ')}`;
}

function runDualTmux(options: DualOptions): number {
  if (!tmuxAvailable()) {
    process.stderr.write('tmux is required for codex:live:dual\n');
    return 1;
  }

  const liveCommand = buildLiveCommand(options);
  const tailCommand = buildTailCommand(options);

  process.stderr.write(
    `[dual] conversation=${options.conversationId} turn=${options.turnId} session=${options.sessionName}\n`
  );
  if (options.debug) {
    process.stderr.write(`[dual] live-command: ${liveCommand}\n`);
    process.stderr.write(`[dual] tail-command: ${tailCommand}\n`);
  }

  const insideTmux = typeof process.env.TMUX === 'string' && process.env.TMUX.length > 0;
  if (options.debug) {
    process.stderr.write(`[dual] inside-tmux=${String(insideTmux)}\n`);
  }

  if (insideTmux) {
    const windowName = `codex-${options.conversationId.slice(-6)}`;
    runTmux(['new-window', '-n', windowName, liveCommand]);
    runTmux(['set-window-option', '-t', windowName, 'remain-on-exit', 'on']);
    runTmux(['split-window', '-h', '-t', windowName, tailCommand]);
    runTmux(['select-layout', '-t', windowName, 'even-horizontal']);
    runTmux(['select-pane', '-t', `${windowName}.0`, '-T', 'codex-live']);
    runTmux(['select-pane', '-t', `${windowName}.1`, '-T', 'event-tail']);
    if (options.captureDir !== null) {
      const captureDirPath = resolve(process.cwd(), options.captureDir);
      mkdirSync(captureDirPath, { recursive: true });
      const liveCapture = resolve(captureDirPath, `${options.conversationId}-live-pane.log`);
      const tailCapture = resolve(captureDirPath, `${options.conversationId}-tail-pane.log`);
      runTmux(['pipe-pane', '-o', '-t', `${windowName}.0`, `cat >> ${shellQuote(liveCapture)}`]);
      runTmux(['pipe-pane', '-o', '-t', `${windowName}.1`, `cat >> ${shellQuote(tailCapture)}`]);
      if (options.debug) {
        process.stderr.write(`[dual] capture-live=${liveCapture}\n`);
        process.stderr.write(`[dual] capture-tail=${tailCapture}\n`);
      }
    }
    runTmux(['select-pane', '-t', `${windowName}.0`]);
    return 0;
  }

  runTmux(['new-session', '-d', '-s', options.sessionName, liveCommand]);
  runTmux(['set-window-option', '-t', `${options.sessionName}:0`, 'remain-on-exit', 'on']);
  runTmux(['split-window', '-h', '-t', `${options.sessionName}:0`, tailCommand]);
  runTmux(['select-layout', '-t', `${options.sessionName}:0`, 'even-horizontal']);
  runTmux(['select-pane', '-t', `${options.sessionName}:0.0`, '-T', 'codex-live']);
  runTmux(['select-pane', '-t', `${options.sessionName}:0.1`, '-T', 'event-tail']);
  if (options.captureDir !== null) {
    const captureDirPath = resolve(process.cwd(), options.captureDir);
    mkdirSync(captureDirPath, { recursive: true });
    const liveCapture = resolve(captureDirPath, `${options.conversationId}-live-pane.log`);
    const tailCapture = resolve(captureDirPath, `${options.conversationId}-tail-pane.log`);
    runTmux([
      'pipe-pane',
      '-o',
      '-t',
      `${options.sessionName}:0.0`,
      `cat >> ${shellQuote(liveCapture)}`
    ]);
    runTmux([
      'pipe-pane',
      '-o',
      '-t',
      `${options.sessionName}:0.1`,
      `cat >> ${shellQuote(tailCapture)}`
    ]);
    if (options.debug) {
      process.stderr.write(`[dual] capture-live=${liveCapture}\n`);
      process.stderr.write(`[dual] capture-tail=${tailCapture}\n`);
    }
  }
  runTmux(['select-pane', '-t', `${options.sessionName}:0.0`]);
  runTmux(['attach-session', '-t', options.sessionName]);
  return 0;
}

function main(): number {
  const options = parseArgs(process.argv.slice(2));

  try {
    return runDualTmux(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'failed to launch dual view';
    process.stderr.write(`${message}\n`);
    return 1;
  }
}

process.exitCode = main();
