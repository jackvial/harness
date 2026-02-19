import { appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import {
  CURSOR_HOOK_NOTIFY_FILE_ENV,
  CURSOR_HOOK_SESSION_ID_ENV,
} from '../src/cursor/managed-hooks.ts';

interface CursorPromptExtraction {
  readonly prompt: string | null;
  readonly resumeId: string | null;
}

const VALUE_OPTIONS = new Set([
  '--api-key',
  '--header',
  '-H',
  '--output-format',
  '--mode',
  '--model',
  '--sandbox',
  '--workspace',
]);

function isOptionToken(value: string): boolean {
  return value.startsWith('-');
}

function readNonEmpty(value: string | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractCursorPrompt(args: readonly string[]): CursorPromptExtraction {
  const remaining = [...args];
  if (remaining[0] === 'agent') {
    remaining.shift();
  }

  const positional: string[] = [];
  let expectValueFor: string | null = null;
  let afterSeparator = false;
  let resumeId: string | null = null;

  for (let index = 0; index < remaining.length; index += 1) {
    const arg = remaining[index] ?? '';

    if (afterSeparator) {
      positional.push(arg);
      continue;
    }

    if (expectValueFor !== null) {
      if (expectValueFor === '--resume') {
        if (!isOptionToken(arg)) {
          resumeId = readNonEmpty(arg);
        }
      }
      expectValueFor = null;
      continue;
    }

    if (arg === '--') {
      afterSeparator = true;
      continue;
    }

    if (arg === '--resume' || arg === '-r') {
      expectValueFor = '--resume';
      continue;
    }
    if (arg.startsWith('--resume=')) {
      resumeId = readNonEmpty(arg.slice('--resume='.length));
      continue;
    }

    if (
      arg.startsWith('--api-key=') ||
      arg.startsWith('--header=') ||
      arg.startsWith('--output-format=') ||
      arg.startsWith('--mode=') ||
      arg.startsWith('--model=') ||
      arg.startsWith('--sandbox=') ||
      arg.startsWith('--workspace=')
    ) {
      continue;
    }

    if (VALUE_OPTIONS.has(arg)) {
      expectValueFor = arg;
      continue;
    }

    if (isOptionToken(arg)) {
      continue;
    }

    positional.push(arg);
  }

  const prompt = readNonEmpty(positional.join(' '));
  return {
    prompt,
    resumeId,
  };
}

function appendCursorPromptRecord(prompt: string, resumeId: string | null): void {
  const notifyFilePath = readNonEmpty(process.env[CURSOR_HOOK_NOTIFY_FILE_ENV]);
  if (notifyFilePath === null) {
    return;
  }

  const payload: Record<string, unknown> = {
    hook_event_name: 'beforeSubmitPrompt',
    hookEventName: 'beforeSubmitPrompt',
    prompt,
  };

  if (resumeId !== null) {
    payload['conversation_id'] = resumeId;
    payload['conversationId'] = resumeId;
  }

  const harnessSessionId = readNonEmpty(process.env[CURSOR_HOOK_SESSION_ID_ENV]);
  if (harnessSessionId !== null) {
    payload['harness_session_id'] = harnessSessionId;
    payload['harnessSessionId'] = harnessSessionId;
  }

  const record = {
    ts: new Date().toISOString(),
    payload,
  };

  try {
    appendFileSync(notifyFilePath, `${JSON.stringify(record)}\n`, 'utf8');
  } catch {
    // Best-effort prompt capture side channel.
  }
}

async function forwardToAgent(command: string, args: readonly string[]): Promise<number> {
  return await new Promise<number>((resolve) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: process.env,
    });

    child.once('error', (error: Error) => {
      process.stderr.write(
        `cursor-prompt-wrapper: failed to launch ${command}: ${error.message}\n`,
      );
      resolve(127);
    });

    child.once('exit', (code, signal) => {
      if (typeof code === 'number') {
        resolve(code);
        return;
      }
      if (signal === null) {
        resolve(1);
        return;
      }
      process.stderr.write(`cursor-prompt-wrapper: child exited via signal ${signal}\n`);
      resolve(1);
    });
  });
}

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);
  const normalizedCommand = readNonEmpty(command);
  if (normalizedCommand === null) {
    process.stderr.write('cursor-prompt-wrapper: missing agent command\n');
    return 2;
  }

  const extracted = extractCursorPrompt(args);
  if (extracted.prompt !== null) {
    appendCursorPromptRecord(extracted.prompt, extracted.resumeId);
  }

  return await forwardToAgent(normalizedCommand, args);
}

process.exitCode = await main();
