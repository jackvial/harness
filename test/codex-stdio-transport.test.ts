import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CodexStdioTransport } from '../src/adapters/codex-stdio-transport.ts';
import type { CodexNotification } from '../src/adapters/codex-event-mapper.ts';

function waitForCondition(
  predicate: () => boolean,
  description: string,
  timeoutMs = 5000
): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`timed out waiting for ${description}`));
        return;
      }
      setTimeout(tick, 10);
    };
    tick();
  });
}

function createMockServerScriptPath(): { dirPath: string; scriptPath: string } {
  const dirPath = mkdtempSync(join(tmpdir(), 'harness-codex-stdio-'));
  const scriptPath = join(dirPath, 'mock-codex-server.cjs');
const script = `
const readline = require('node:readline');
if (process.argv.includes('--exit-immediately')) {
  process.exit(0);
}
let failInitOnce = process.argv.includes('--init-fail-once');
const methodsSeen = [];
const rl = readline.createInterface({ input: process.stdin });
function send(value) { process.stdout.write(JSON.stringify(value) + '\\n'); }
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return;
  }
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }

  const method = message.method;
  if (typeof method === 'string') {
    methodsSeen.push(method);
  }

  if (method === 'initialize') {
    if (failInitOnce) {
      failInitOnce = false;
      send({ jsonrpc: '2.0', id: message.id, error: { code: 500, message: 'init failed' } });
      return;
    }
    send({ jsonrpc: '2.0', id: message.id, result: { userAgent: 'mock-codex' } });
    return;
  }

  if (method === 'initialized') {
    return;
  }

  if (method === 'method-order/test') {
    send({ jsonrpc: '2.0', id: message.id, result: { methods: methodsSeen } });
    return;
  }

  if (method === 'thread/start') {
    send({ jsonrpc: '2.0', id: message.id, result: { threadId: 'thread-1' } });
    send({ jsonrpc: '2.0', method: 'thread/started', params: { threadId: 'thread-1' } });
    return;
  }

  if (method === 'error/test') {
    send({ jsonrpc: '2.0', id: message.id, error: { code: 400, message: 'bad request' } });
    return;
  }

  if (method === 'error/no-message') {
    send({ jsonrpc: '2.0', id: message.id, error: { code: 500 } });
    return;
  }

  if (method === 'invalid/test') {
    process.stdout.write('not-json\\n');
    send({ jsonrpc: '2.0', id: message.id, result: { ok: true } });
    return;
  }

  if (method === 'blank-line/test') {
    process.stdout.write('\\n');
    send({ jsonrpc: '2.0', id: message.id, result: { ok: true } });
    return;
  }

  if (method === 'malformed-messages/test') {
    process.stdout.write('1\\n');
    process.stdout.write(JSON.stringify({ id: 'bad' }) + '\\n');
    process.stdout.write(JSON.stringify({ method: 'weird', id: 42 }) + '\\n');
    send({ jsonrpc: '2.0', id: message.id, result: { ok: true } });
    return;
  }

  if (method === 'unknown-id/test') {
    send({ jsonrpc: '2.0', id: 999999, result: { ignored: true } });
    send({ jsonrpc: '2.0', id: message.id, result: { ok: true } });
    return;
  }

  if (method === 'stderr/test') {
    process.stderr.write('server-stderr\\n');
    send({ jsonrpc: '2.0', id: message.id, result: { ok: true } });
    return;
  }

  if (method === 'never/respond') {
    return;
  }

  if (method === 'exit/now') {
    process.exit(0);
  }

  send({ jsonrpc: '2.0', id: message.id, result: { ok: true } });
});
`;
  writeFileSync(scriptPath, script, 'utf8');
  return { dirPath, scriptPath };
}

function createMockCodexCommandPath(): { dirPath: string; commandPath: string } {
  const dirPath = mkdtempSync(join(tmpdir(), 'harness-codex-command-'));
  const commandPath = join(dirPath, 'codex');
  const script = `#!/usr/bin/env node
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
function send(value) { process.stdout.write(JSON.stringify(value) + '\\n'); }
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return;
  }
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (message.method === 'thread/start') {
    send({ jsonrpc: '2.0', id: message.id, result: { threadId: 'thread-default' } });
    return;
  }
  send({ jsonrpc: '2.0', id: message.id, result: { ok: true, argv: process.argv.slice(2) } });
});
`;
  writeFileSync(commandPath, script, 'utf8');
  chmodSync(commandPath, 0o755);
  return { dirPath, commandPath };
}

void test('codex stdio transport handles request response and notifications', async () => {
  const { dirPath, scriptPath } = createMockServerScriptPath();
  const transport = new CodexStdioTransport({
    command: process.execPath,
    args: [scriptPath]
  });

  try {
    const notifications: CodexNotification[] = [];
    const unsubscribe = transport.subscribe((notification) => {
      notifications.push(notification);
    });

    const result = await transport.request('thread/start', { prompt: 'hello' });
    assert.deepEqual(result, { threadId: 'thread-1' });
    await waitForCondition(() => notifications.length === 1, 'thread-started notification');
    assert.equal(notifications[0]?.method, 'thread/started');

    unsubscribe();
    await transport.request('unknown-id/test', {});
    assert.equal(notifications.length, 1);
  } finally {
    transport.close();
    rmSync(dirPath, { recursive: true, force: true });
  }
});

void test('codex stdio transport initializes once before first request', async () => {
  const { dirPath, scriptPath } = createMockServerScriptPath();
  const transport = new CodexStdioTransport({
    command: process.execPath,
    args: [scriptPath]
  });

  try {
    const first = await transport.request('method-order/test', {});
    assert.deepEqual(first, {
      methods: ['initialize', 'initialized', 'method-order/test']
    });

    const second = await transport.request('method-order/test', {});
    assert.deepEqual(second, {
      methods: ['initialize', 'initialized', 'method-order/test', 'method-order/test']
    });
  } finally {
    transport.close();
    rmSync(dirPath, { recursive: true, force: true });
  }
});

void test('codex stdio transport supports disabling initialization handshake', async () => {
  const { dirPath, scriptPath } = createMockServerScriptPath();
  const transport = new CodexStdioTransport({
    command: process.execPath,
    args: [scriptPath],
    initialization: {
      enabled: false
    }
  });

  try {
    const result = await transport.request('method-order/test', {});
    assert.deepEqual(result, {
      methods: ['method-order/test']
    });
  } finally {
    transport.close();
    rmSync(dirPath, { recursive: true, force: true });
  }
});

void test('codex stdio transport retries initialization after a failed initialize request', async () => {
  const { dirPath, scriptPath } = createMockServerScriptPath();
  const transport = new CodexStdioTransport({
    command: process.execPath,
    args: [scriptPath, '--init-fail-once']
  });

  try {
    await assert.rejects(async () => {
      await transport.request('method-order/test', {});
    }, /init failed/);

    const result = await transport.request('method-order/test', {});
    assert.deepEqual(result, {
      methods: ['initialize', 'initialize', 'initialized', 'method-order/test']
    });
  } finally {
    transport.close();
    rmSync(dirPath, { recursive: true, force: true });
  }
});

void test('codex stdio transport shares in-flight initialization across concurrent requests', async () => {
  const { dirPath, scriptPath } = createMockServerScriptPath();
  const transport = new CodexStdioTransport({
    command: process.execPath,
    args: [scriptPath]
  });

  try {
    const first = transport.request('method-order/test', {});
    const second = transport.request('method-order/test', {});
    const results = await Promise.all([first, second]);

    assert.deepEqual(results[0], {
      methods: ['initialize', 'initialized', 'method-order/test']
    });
    assert.deepEqual(results[1], {
      methods: ['initialize', 'initialized', 'method-order/test', 'method-order/test']
    });
  } finally {
    transport.close();
    rmSync(dirPath, { recursive: true, force: true });
  }
});

void test('codex stdio transport uses default command and args via PATH lookup', async () => {
  const { dirPath, commandPath } = createMockCodexCommandPath();
  const pathPrefix = dirPath;
  const existingPath = process.env.PATH ?? '';
  const pathValue = `${pathPrefix}:${existingPath}`;
  const transport = new CodexStdioTransport({
    env: {
      ...process.env,
      PATH: pathValue
    }
  });

  try {
    const result = await transport.request('thread/start', { prompt: 'default' });
    assert.deepEqual(result, { threadId: 'thread-default' });

    const argsResult = await transport.request('args-check', {});
    assert.deepEqual(argsResult, {
      ok: true,
      argv: ['app-server', '--listen', 'stdio://']
    });
    assert.equal(commandPath.endsWith('/codex'), true);
  } finally {
    transport.close();
    rmSync(dirPath, { recursive: true, force: true });
  }
});

void test('codex stdio transport supports constructor default options parameter', async () => {
  const { dirPath } = createMockCodexCommandPath();
  const previousPath = process.env.PATH;
  process.env.PATH = `${dirPath}:${previousPath ?? ''}`;

  const transport = new CodexStdioTransport();
  try {
    const result = await transport.request('thread/start', { prompt: 'defaults-parameter' });
    assert.deepEqual(result, { threadId: 'thread-default' });
  } finally {
    transport.close();
    process.env.PATH = previousPath;
    rmSync(dirPath, { recursive: true, force: true });
  }
});

void test('codex stdio transport surfaces json-rpc errors', async () => {
  const { dirPath, scriptPath } = createMockServerScriptPath();
  const transport = new CodexStdioTransport({
    command: process.execPath,
    args: [scriptPath]
  });

  try {
    await assert.rejects(async () => {
      await transport.request('error/test', {});
    }, /bad request/);

    await assert.rejects(async () => {
      await transport.request('error/no-message', {});
    }, /json-rpc error/);
  } finally {
    transport.close();
    rmSync(dirPath, { recursive: true, force: true });
  }
});

void test('codex stdio transport ignores invalid json lines and unknown response ids', async () => {
  const { dirPath, scriptPath } = createMockServerScriptPath();
  const transport = new CodexStdioTransport({
    command: process.execPath,
    args: [scriptPath]
  });

  try {
    const result = await transport.request('invalid/test', {});
    assert.deepEqual(result, { ok: true });

    const resultWithBlankLine = await transport.request('blank-line/test', {});
    assert.deepEqual(resultWithBlankLine, { ok: true });

    const resultWithMalformedMessages = await transport.request('malformed-messages/test', {});
    assert.deepEqual(resultWithMalformedMessages, { ok: true });
  } finally {
    transport.close();
    rmSync(dirPath, { recursive: true, force: true });
  }
});

void test('codex stdio transport forwards stderr and rejects pending requests when closed', async () => {
  const { dirPath, scriptPath } = createMockServerScriptPath();
  const stderrChunks: Buffer[] = [];
  const transport = new CodexStdioTransport({
    command: process.execPath,
    args: [scriptPath],
    onStderr: (chunk: Buffer) => {
      stderrChunks.push(chunk);
    }
  });

  try {
    await transport.request('stderr/test', {});
    assert.equal(stderrChunks.length > 0, true);

    const pending = transport.request('never/respond', {});
    transport.close();
    await assert.rejects(async () => pending, /transport( is)? closed/);

    await assert.rejects(async () => {
      await transport.request('thread/start', { prompt: 'after-close' });
    }, /transport is closed/);
  } finally {
    transport.close();
    rmSync(dirPath, { recursive: true, force: true });
  }
});

void test('codex stdio transport rejects pending requests when server exits', async () => {
  const { dirPath, scriptPath } = createMockServerScriptPath();
  const transport = new CodexStdioTransport({
    command: process.execPath,
    args: [scriptPath]
  });

  try {
    const pending = transport.request('exit/now', {});
    await assert.rejects(async () => pending, /codex app-server exited/);
  } finally {
    transport.close();
    rmSync(dirPath, { recursive: true, force: true });
  }
});

void test('codex stdio transport handles spawn errors and write callback errors', async () => {
  const missingTransport = new CodexStdioTransport({
    command: '/definitely/missing/codex-binary'
  });
  try {
    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
    await assert.rejects(async () => {
      await missingTransport.request('thread/start', {});
    });
  } finally {
    missingTransport.close();
  }

  const { dirPath, scriptPath } = createMockServerScriptPath();
  const exitingTransport = new CodexStdioTransport({
    command: process.execPath,
    args: [scriptPath, '--exit-immediately']
  });
  try {
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    await assert.rejects(async () => {
      await exitingTransport.request('thread/start', {});
    });
  } finally {
    exitingTransport.close();
    rmSync(dirPath, { recursive: true, force: true });
  }

  const second = createMockServerScriptPath();
  const raceTransport = new CodexStdioTransport({
    command: process.execPath,
    args: [second.scriptPath, '--exit-immediately']
  });
  try {
    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
    const pending = raceTransport.request('thread/start', {});
    raceTransport.close();
    await assert.rejects(async () => pending);
  } finally {
    raceTransport.close();
    rmSync(second.dirPath, { recursive: true, force: true });
  }
});
