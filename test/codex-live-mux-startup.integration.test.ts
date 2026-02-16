import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startPtySession, type PtyExit } from '../src/pty/pty_host.ts';
import { SqliteControlPlaneStore } from '../src/store/control-plane-store.ts';

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

function isPtyExit(value: unknown): value is PtyExit {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { code?: unknown; signal?: unknown };
  const codeOk = typeof candidate.code === 'number' || candidate.code === null;
  const signalOk = typeof candidate.signal === 'string' || candidate.signal === null;
  return codeOk && signalOk;
}

function waitForExit(
  session: ReturnType<typeof startPtySession>,
  timeoutMs: number
): Promise<PtyExit> {
  return new Promise((resolveExit, rejectExit) => {
    const timer = setTimeout(() => {
      rejectExit(new Error('timed out waiting for codex-live-mux exit'));
    }, timeoutMs);
    session.once('exit', (result: unknown) => {
      clearTimeout(timer);
      if (!isPtyExit(result)) {
        rejectExit(new Error('received malformed pty exit payload'));
        return;
      }
      resolveExit(result);
    });
  });
}

function createWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'harness-mux-startup-'));
}

function normalizeTerminalOutput(value: string): string {
  const ESC = String.fromCharCode(27);
  const BEL = String.fromCharCode(7);
  const oscPattern = new RegExp(`${ESC}\\][^${BEL}]*${BEL}`, 'gu');
  const csiPattern = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, 'gu');
  const escPattern = new RegExp(`${ESC}[@-_]`, 'gu');
  return value
    .replace(oscPattern, '')
    .replace(csiPattern, '')
    .replace(escPattern, '')
    .replace(/\r/gu, '');
}

async function captureMuxBootOutput(
  workspace: string,
  durationMs: number
): Promise<{ output: string; exit: PtyExit }> {
  const scriptPath = resolve(process.cwd(), 'scripts/codex-live-mux.ts');
  const collected: Buffer[] = [];
  const session = startPtySession({
    command: process.execPath,
    commandArgs: ['--experimental-strip-types', scriptPath],
    cwd: workspace,
    env: {
      ...process.env,
      HARNESS_INVOKE_CWD: workspace
    }
  });
  let exitResult: PtyExit | null = null;
  const exitPromise = waitForExit(session, 12000);
  session.on('data', (chunk: Buffer) => {
    collected.push(chunk);
  });
  session.once('exit', (result: unknown) => {
    if (isPtyExit(result)) {
      exitResult = result;
    }
  });

  try {
    await delay(durationMs);
  } finally {
    if (exitResult === null) {
      session.write('\u0003');
    }
  }

  const exit = await exitPromise;
  return {
    output: normalizeTerminalOutput(Buffer.concat(collected).toString('utf8')),
    exit
  };
}

void test(
  'codex-live-mux startup bootstraps task hydration without temporal dead zone fatal errors',
  { timeout: 20000 },
  async () => {
    const workspace = createWorkspace();

    try {
      const result = await captureMuxBootOutput(workspace, 1800);
      assert.equal(result.exit.signal, null);
      assert.equal(result.exit.code, 0);
      const output = result.output;
      assert.equal(output.includes('codex:live:mux fatal error'), false);
      assert.equal(output.includes('Cannot access'), false);
      assert.equal(output.includes('ReferenceError'), false);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  }
);

void test(
  'codex-live-mux renders empty-workspace repository and task controls without seeded threads',
  { timeout: 20000 },
  async () => {
    const workspace = createWorkspace();

    try {
      const result = await captureMuxBootOutput(workspace, 1800);
      const output = result.output;
      assert.equal(output.includes('repositories [-]'), true);
      assert.equal(output.includes('[ > add repository ]'), true);
      assert.equal(output.includes('no repositories'), true);
      assert.equal(output.includes('[ > add project ]'), true);
      assert.equal(output.includes('[ # tasks ]'), true);
      assert.equal(output.includes('[ + new thread ]'), true);
      assert.equal(output.includes('○ codex'), false);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  }
);

void test(
  'codex-live-mux startup does not auto-create conversation records before explicit thread creation',
  { timeout: 20000 },
  async () => {
    const workspace = createWorkspace();

    try {
      await captureMuxBootOutput(workspace, 1800);
      const storePath = join(workspace, '.harness', 'control-plane.sqlite');
      assert.equal(existsSync(storePath), true);

      const store = new SqliteControlPlaneStore(storePath);
      try {
        assert.equal(store.listConversations({ includeArchived: true }).length, 0);
      } finally {
        store.close();
      }
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  }
);
