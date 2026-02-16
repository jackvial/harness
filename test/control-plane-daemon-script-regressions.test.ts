import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

void test('control-plane-daemon forwards launch command and base args into session options', () => {
  const scriptPath = resolve(process.cwd(), 'scripts/control-plane-daemon.ts');
  const source = readFileSync(scriptPath, 'utf8');

  assert.equal(source.includes('if (input.command !== undefined) {'), true);
  assert.equal(source.includes('sessionOptions.command = input.command;'), true);
  assert.equal(source.includes('if (input.baseArgs !== undefined) {'), true);
  assert.equal(source.includes('sessionOptions.baseArgs = input.baseArgs;'), true);
});
