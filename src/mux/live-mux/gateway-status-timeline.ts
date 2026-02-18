import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveStatusTimelineStatePath } from './status-timeline-state.ts';

type GatewayStatusTimelineAction = 'start' | 'stop';

interface RunHarnessStatusTimelineCommandInput {
  readonly invocationDirectory: string;
  readonly harnessScriptPath: string;
  readonly sessionName: string | null;
  readonly action: GatewayStatusTimelineAction;
}

interface RunHarnessStatusTimelineCommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

interface ToggleGatewayStatusTimelineOptions {
  readonly invocationDirectory: string;
  readonly sessionName: string | null;
  readonly statusTimelineStateExists?: (statusTimelineStatePath: string) => boolean;
  readonly runHarnessStatusTimelineCommand?: (
    input: RunHarnessStatusTimelineCommandInput,
  ) => Promise<RunHarnessStatusTimelineCommandResult>;
  readonly harnessScriptPath?: string;
}

interface ToggleGatewayStatusTimelineResult {
  readonly action: GatewayStatusTimelineAction;
  readonly message: string;
  readonly stdout: string;
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_HARNESS_SCRIPT_PATH = resolve(SCRIPT_DIR, '../../../scripts/harness.ts');

function firstNonEmptyLine(text: string): string | null {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines[0] ?? null;
}

export function resolveHarnessStatusTimelineCommandArgs(
  action: GatewayStatusTimelineAction,
  sessionName: string | null,
): readonly string[] {
  if (sessionName === null) {
    return ['status-timeline', action];
  }
  return ['--session', sessionName, 'status-timeline', action];
}

function summarizeStatusTimelineSuccess(action: GatewayStatusTimelineAction, stdout: string): string {
  const firstLine = firstNonEmptyLine(stdout);
  if (firstLine !== null) {
    return firstLine;
  }
  if (action === 'start') {
    return 'status timeline started';
  }
  return 'status timeline stopped';
}

function summarizeStatusTimelineFailure(
  action: GatewayStatusTimelineAction,
  stderr: string,
  stdout: string,
): string {
  const detail = firstNonEmptyLine(stderr) ?? firstNonEmptyLine(stdout) ?? 'unknown error';
  return `status timeline ${action} failed: ${detail}`;
}

async function runHarnessStatusTimelineCommand(
  input: RunHarnessStatusTimelineCommandInput,
): Promise<RunHarnessStatusTimelineCommandResult> {
  const commandArgs = resolveHarnessStatusTimelineCommandArgs(input.action, input.sessionName);
  const child = spawn(process.execPath, [input.harnessScriptPath, ...commandArgs], {
    cwd: input.invocationDirectory,
    env: {
      ...process.env,
      HARNESS_INVOKE_CWD: input.invocationDirectory,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout?.on('data', (chunk: Buffer | string) => {
    stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  child.stderr?.on('data', (chunk: Buffer | string) => {
    stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });

  const [code, signal] = await new Promise<[number | null, NodeJS.Signals | null]>(
    (resolveExit, rejectExit) => {
      child.once('error', rejectExit);
      child.once('exit', (exitCode, exitSignal) => {
        resolveExit([exitCode, exitSignal]);
      });
    },
  );

  const stdout = Buffer.concat(stdoutChunks).toString('utf8');
  const stderr = Buffer.concat(stderrChunks).toString('utf8');
  const exitCode = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
  if (exitCode !== 0) {
    throw new Error(summarizeStatusTimelineFailure(input.action, stderr, stdout));
  }

  return {
    stdout,
    stderr,
  };
}

export async function toggleGatewayStatusTimeline(
  options: ToggleGatewayStatusTimelineOptions,
): Promise<ToggleGatewayStatusTimelineResult> {
  const statePath = resolveStatusTimelineStatePath(options.invocationDirectory, options.sessionName);
  const isRunning = (options.statusTimelineStateExists ?? existsSync)(statePath);
  const action: GatewayStatusTimelineAction = isRunning ? 'stop' : 'start';
  const harnessScriptPath = options.harnessScriptPath ?? DEFAULT_HARNESS_SCRIPT_PATH;
  const runCommand = options.runHarnessStatusTimelineCommand ?? runHarnessStatusTimelineCommand;
  const result = await runCommand({
    invocationDirectory: options.invocationDirectory,
    harnessScriptPath,
    sessionName: options.sessionName,
    action,
  });
  return {
    action,
    message: summarizeStatusTimelineSuccess(action, result.stdout),
    stdout: result.stdout,
  };
}
