import { startPtySession, type PtyExit } from '../src/pty/pty_host.ts';

const DEFAULT_VIM_PATH = '/usr/bin/vim';

function writeStderr(message: string): void {
  process.stderr.write(message);
}

function getInitialSize(): { cols: number; rows: number } {
  const cols = process.stdout.columns;
  const rows = process.stdout.rows;
  if (typeof cols === 'number' && cols > 0 && typeof rows === 'number' && rows > 0) {
    return { cols, rows };
  }
  return { cols: 80, rows: 24 };
}

function normalizeExitCode(exit: PtyExit): number {
  if (exit.code !== null) {
    return exit.code;
  }
  if (exit.signal !== null) {
    return 128;
  }
  return 1;
}

async function main(): Promise<number> {
  const vimPath = process.env.HARNESS_VIM_PATH ?? DEFAULT_VIM_PATH;
  const vimArgs = process.argv.slice(2);
  const interactive = process.stdin.isTTY && process.stdout.isTTY;

  const session = startPtySession({
    command: vimPath,
    commandArgs: vimArgs,
    env: {
      ...process.env,
      TERM: process.env.TERM ?? 'xterm-256color',
    },
  });

  let restored = false;
  const onInput = (chunk: Buffer): void => {
    session.write(chunk);
  };
  const onResize = (): void => {
    const size = getInitialSize();
    session.resize(size.cols, size.rows);
  };

  const restoreTerminal = (): void => {
    if (restored) {
      return;
    }
    restored = true;

    process.stdin.off('data', onInput);
    process.stdout.off('resize', onResize);
    process.stdin.pause();

    if (interactive) {
      process.stdin.setRawMode(false);
    }
  };

  const closeSession = (): void => {
    session.close();
  };

  process.once('SIGTERM', closeSession);
  process.once('SIGHUP', closeSession);

  session.on('data', (chunk: Buffer) => {
    process.stdout.write(chunk);
  });

  session.on('error', (error: Error) => {
    restoreTerminal();
    writeStderr(`vim passthrough error: ${error.message}\n`);
    process.exit(1);
  });

  const exitPromise = new Promise<PtyExit>((resolve) => {
    session.once('exit', (value: unknown) => {
      resolve(value as PtyExit);
    });
  });

  if (interactive) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.on('data', onInput);
  process.stdout.on('resize', onResize);
  onResize();

  const exit = await exitPromise;
  restoreTerminal();
  return normalizeExitCode(exit);
}

const exitCode = await main();
process.exitCode = exitCode;
