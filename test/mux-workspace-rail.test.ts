import assert from 'node:assert/strict';
import test from 'node:test';
import { renderWorkspaceRailAnsiRows } from '../src/mux/workspace-rail.ts';

void test('workspace rail renders directory-centric rows with title and status metadata', () => {
  const rows = renderWorkspaceRailAnsiRows(
    {
      directories: [
        {
          key: 'harness:local',
          workspaceId: '~/dev/harness',
          worktreeId: 'worktree-local',
          active: true,
          git: {
            branch: 'main',
            additions: 12,
            deletions: 3,
            changedFiles: 4
          }
        }
      ],
      conversations: [
        {
          sessionId: 'conversation-a',
          directoryKey: 'harness:local',
          title: 'untitled task 1',
          agentLabel: 'codex',
          cpuPercent: 0.2,
          memoryMb: 12,
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:02:59.000Z'
        },
        {
          sessionId: 'conversation-b',
          directoryKey: 'harness:local',
          title: 'untitled task 2',
          agentLabel: 'codex',
          cpuPercent: null,
          memoryMb: 8,
          status: 'completed',
          attentionReason: null,
          startedAt: '2026-01-01T00:02:40.000Z',
          lastEventAt: '2026-01-01T00:02:50.000Z'
        }
      ],
      processes: [
        {
          key: 'proc-dev',
          directoryKey: 'harness:local',
          label: 'npm run dev',
          cpuPercent: 3.4,
          memoryMb: 180,
          status: 'running'
        }
      ],
      activeConversationId: 'conversation-a',
      nowMs: Date.parse('2026-01-01T00:03:00.000Z')
    },
    100,
    24
  );

  assert.equal(rows.length, 24);
  assert.equal(rows.some((row) => row.includes('📁 ~/dev/harness ─ main')), true);
  assert.equal(rows.some((row) => row.includes('+12 -3 │ 4 files')), true);
  assert.equal(rows.some((row) => row.includes('codex - untitled task 1')), true);
  assert.equal(rows.some((row) => row.includes('● working')), true);
  assert.equal(rows.some((row) => row.includes('○ complete')), true);
  assert.equal(rows.some((row) => row.includes('⚙ npm run dev')), true);
  assert.equal(rows.some((row) => row.includes('running · 3.4% · 180MB')), true);
  assert.equal(rows.some((row) => row.includes('\u001b[0;38;5;254;48;5;238m')), true);
  assert.equal(rows.some((row) => row.includes('\u001b[0;38;5;245;49m│ \u001b[0;38;5;254;48;5;238m')), true);
  assert.equal(rows.some((row) => row.includes('conversation-a')), false);
});

void test('workspace rail keeps shortcut actions pinned to bottom rows when vertical list is truncated', () => {
  const rows = renderWorkspaceRailAnsiRows(
    {
      directories: [
        {
          key: 'd',
          workspaceId: 'harness',
          worktreeId: 'worktree-local',
          active: false,
          git: {
            branch: 'main',
            additions: 0,
            deletions: 0,
            changedFiles: 0
          }
        }
      ],
      conversations: [],
      processes: [],
      activeConversationId: null,
      nowMs: Date.parse('2026-01-01T00:00:00.000Z')
    },
    64,
    6
  );

  assert.equal(rows.length, 6);
  assert.equal(rows[0]?.includes('ctrl+j/k switch conversation'), true);
  assert.equal(rows[1]?.includes('ctrl+c x2 quit mux'), true);
  assert.equal(rows[5]?.includes('close directory'), true);
});

void test('workspace rail handles tiny row counts by showing shortcut tail', () => {
  const rows = renderWorkspaceRailAnsiRows(
    {
      directories: [],
      conversations: [],
      processes: [],
      activeConversationId: null,
      nowMs: Date.parse('2026-01-01T00:00:00.000Z')
    },
    24,
    1
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.includes('close directory'), true);
});

void test('workspace rail keeps full height when shortcut hint text is provided', () => {
  const rows = renderWorkspaceRailAnsiRows(
    {
      directories: [],
      conversations: [],
      processes: [],
      activeConversationId: null,
      shortcutHint: 'ctrl+t new  ctrl+n/p switch  ctrl+c x2 quit',
      nowMs: Date.parse('2026-01-01T00:00:00.000Z')
    },
    40,
    8
  );

  assert.equal(rows.length, 8);
  assert.equal(rows.some((row) => row.includes('ctrl+n/p switch')), true);
  assert.equal(rows.some((row) => row.includes('close directory')), true);
});

void test('workspace rail collapses shortcut descriptions while retaining toggle header and actions', () => {
  const rows = renderWorkspaceRailAnsiRows(
    {
      directories: [],
      conversations: [],
      processes: [],
      activeConversationId: null,
      shortcutsCollapsed: true,
      nowMs: Date.parse('2026-01-01T00:00:00.000Z')
    },
    40,
    8
  );

  assert.equal(rows.length, 8);
  assert.equal(rows.some((row) => row.includes('shortcuts [+]')), true);
  assert.equal(rows.some((row) => row.includes('ctrl+t new conversation')), false);
  assert.equal(rows.some((row) => row.includes('new conversation')), true);
});
