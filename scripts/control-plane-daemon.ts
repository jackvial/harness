import { startCodexLiveSession } from '../src/codex/live-session.ts';
import { startControlPlaneStreamServer } from '../src/control-plane/stream-server.ts';

interface DaemonOptions {
  host: string;
  port: number;
}

function parseArgs(argv: string[]): DaemonOptions {
  const defaultHost = process.env.HARNESS_CONTROL_PLANE_HOST ?? '127.0.0.1';
  const defaultPortRaw = process.env.HARNESS_CONTROL_PLANE_PORT ?? '7777';

  let host = defaultHost;
  let portRaw = defaultPortRaw;

  for (let idx = 0; idx < argv.length; idx += 1) {
    const arg = argv[idx]!;
    if (arg === '--host') {
      const value = argv[idx + 1];
      if (value === undefined) {
        throw new Error('missing value for --host');
      }
      host = value;
      idx += 1;
      continue;
    }

    if (arg === '--port') {
      const value = argv[idx + 1];
      if (value === undefined) {
        throw new Error('missing value for --port');
      }
      portRaw = value;
      idx += 1;
      continue;
    }
  }

  const port = Number.parseInt(portRaw, 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`invalid --port value: ${portRaw}`);
  }

  return {
    host,
    port
  };
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));

  const server = await startControlPlaneStreamServer({
    host: options.host,
    port: options.port,
    startSession: (input) =>
      startCodexLiveSession({
        args: input.args,
        env: input.env,
        initialCols: input.initialCols,
        initialRows: input.initialRows,
        terminalForegroundHex: input.terminalForegroundHex,
        terminalBackgroundHex: input.terminalBackgroundHex
      })
  });

  const address = server.address();
  process.stdout.write(
    `[control-plane] listening host=${address.address} port=${String(address.port)}\n`
  );

  let stopRequested = false;
  let resolveStop: (() => void) | null = null;
  const stopPromise = new Promise<void>((resolve) => {
    resolveStop = resolve;
  });

  const requestStop = (): void => {
    if (stopRequested) {
      return;
    }
    stopRequested = true;
    resolveStop?.();
  };

  process.once('SIGINT', requestStop);
  process.once('SIGTERM', requestStop);

  await stopPromise;
  await server.close();
  return 0;
}

try {
  process.exitCode = await main();
} catch (error: unknown) {
  process.stderr.write(
    `control-plane daemon fatal error: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}
