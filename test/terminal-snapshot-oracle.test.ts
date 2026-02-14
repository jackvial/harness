import assert from 'node:assert/strict';
import test from 'node:test';
import { TerminalSnapshotOracle, renderSnapshotText } from '../src/terminal/snapshot-oracle.ts';

void test('snapshot oracle renders text and cursor movement controls', () => {
  const oracle = new TerminalSnapshotOracle(6, 3);
  oracle.ingest('abc');
  oracle.ingest('\rZ');
  oracle.ingest('\n12');
  oracle.ingest('\b3');
  oracle.ingest('\u0001');
  oracle.ingest('\u007f');
  oracle.ingest('\u001bX');

  oracle.ingest('\u001b[s');
  oracle.ingest('\u001b[1;6H');
  oracle.ingest('X');
  oracle.ingest('\u001b[u');
  oracle.ingest('\u001b[2A');
  oracle.ingest('\u001b[2B');
  oracle.ingest('\u001b[2C');
  oracle.ingest('\u001b[1D');
  oracle.ingest('\u001b[4G');
  oracle.ingest('\u001b[f');
  oracle.ingest('\u001b[2;2f');
  oracle.ingest('!');
  oracle.ingest('\u001b[1S');
  oracle.ingest('\u001b[1T');

  const frame = oracle.snapshot();
  assert.equal(frame.rows, 3);
  assert.equal(frame.cols, 6);
  assert.equal(frame.activeScreen, 'primary');
  assert.equal(frame.cursor.visible, true);
  assert.equal(frame.lines[0], '');
  assert.equal(frame.lines[1], ' !3');
  assert.equal(renderSnapshotText(frame), '\n !3\n');
  assert.equal(frame.frameHash.length, 64);
});

void test('snapshot oracle supports clear, osc, and alternate-screen private modes', () => {
  const oracle = new TerminalSnapshotOracle(8, 4);

  oracle.ingest('primary');
  oracle.ingest('\u001b8');
  oracle.ingest('\u001b[u');
  oracle.ingest('\u001b[?1048l');
  oracle.ingest('\u001b[?1049l');
  oracle.ingest('\u001b7');
  oracle.ingest('\u001b[?25l');
  oracle.ingest('\u001b[?1049h');
  oracle.ingest('alt');
  oracle.ingest('\u001b]2;title\u0007');
  oracle.ingest('\u001b]10;?\u001b\\');
  oracle.ingest('\u001b]11;?\u001bx');
  oracle.ingest('\u001b\\');
  oracle.ingest('\u001b[2J');
  oracle.ingest('\u001b[H');
  oracle.ingest('A');
  oracle.ingest('\u001b[2K');
  oracle.ingest('\u001b[1K');
  oracle.ingest('\u001b[K');
  oracle.ingest('\u001b[?1048h');
  oracle.ingest('\u001b[3;3H');
  oracle.ingest('\u001b[?1048l');
  oracle.ingest('\u001b[?1049l');
  oracle.ingest('\u001b[?25h');
  oracle.ingest('\u001b8');
  oracle.ingest('\u001b[?1047h');
  oracle.ingest('Z');
  oracle.ingest('\u001b[?1047l');
  oracle.ingest('\u001b[?;25h');

  const frame = oracle.snapshot();
  assert.equal(frame.activeScreen, 'primary');
  assert.equal(frame.cursor.visible, true);
  assert.equal(frame.lines[0], 'primary');
});

void test('snapshot oracle supports resize guards, mode variants, and deterministic hashes', () => {
  const oracle = new TerminalSnapshotOracle(5, 2);
  oracle.resize(0, 0);
  oracle.resize(5, 0);
  oracle.ingest(Buffer.from('hello', 'utf8'));
  oracle.ingest('\u001b[2J');
  oracle.ingest('q');
  oracle.ingest('\u001b[1J');
  oracle.ingest('w');
  oracle.ingest('\u001b[J');
  oracle.ingest('e');
  oracle.ingest('\u001b[2K');
  oracle.ingest('\u001b[1K');
  oracle.ingest('\u001b[K');
  oracle.ingest('\u001b[3J');
  oracle.ingest('\u001b[?9999h');
  oracle.ingest('\u001b[?9999l');
  oracle.ingest('\u001b[?25m');
  oracle.ingest('\u001b[?25l');
  oracle.ingest('\u001b[?25h');
  oracle.ingest('\u001b[c');

  const beforeResize = oracle.snapshot();
  oracle.resize(7, 3);
  oracle.ingest('ok');
  const afterResize = oracle.snapshot();

  assert.notEqual(beforeResize.frameHash, afterResize.frameHash);
  assert.equal(afterResize.rows, 3);
  assert.equal(afterResize.cols, 7);
  assert.equal(afterResize.lines[0], 'ok');
});

void test('snapshot oracle covers scroll and partial clear branches', () => {
  const wrapOracle = new TerminalSnapshotOracle(2, 1);
  wrapOracle.ingest('abc');
  wrapOracle.ingest('\n');
  const wrapFrame = wrapOracle.snapshot();
  assert.equal(wrapFrame.rows, 1);

  const clearOracle = new TerminalSnapshotOracle(4, 3);
  clearOracle.ingest('ab\ncd');
  clearOracle.ingest('\u001b[2;2H');
  clearOracle.ingest('\u001b[1J');
  const clearFrame = clearOracle.snapshot();
  assert.equal(clearFrame.lines[0], '');
});
