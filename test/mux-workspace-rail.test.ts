import assert from 'node:assert/strict';
import test from 'node:test';
import { renderWorkspaceRailAnsiRows } from '../src/mux/workspace-rail.ts';
import type { ConversationRailSessionSummary } from '../src/mux/conversation-rail.ts';

const conversations: readonly ConversationRailSessionSummary[] = [
  {
    sessionId: 'conversation-aaaaaaaa-1111',
    status: 'running',
    attentionReason: null,
    live: true,
    startedAt: '2026-01-01T00:00:00.000Z',
    lastEventAt: '2026-01-01T00:01:00.000Z'
  },
  {
    sessionId: 'conversation-bbbbbbbb-2222',
    status: 'needs-input',
    attentionReason: 'approval',
    live: true,
    startedAt: '2026-01-01T00:01:00.000Z',
    lastEventAt: '2026-01-01T00:02:00.000Z'
  },
  {
    sessionId: 'external-session-cccccccccccccccc',
    status: 'completed',
    attentionReason: null,
    live: false,
    startedAt: '2026-01-01T00:02:00.000Z',
    lastEventAt: null
  }
];

void test('workspace rail renders directory conversation process and git sections', () => {
  const rows = renderWorkspaceRailAnsiRows(
    {
      directories: [
        {
          key: 'harness-main',
          workspaceId: 'harness',
          worktreeId: 'main',
          active: true
        }
      ],
      conversations,
      activeConversationId: 'conversation-bbbbbbbb-2222',
      processes: [
        {
          key: 'proc-a',
          label: 'codex aaaaaaaa',
          cpuPercent: 1.4,
          memoryMb: 184.2,
          status: 'running'
        },
        {
          key: 'proc-b',
          label: 'codex bbbbbbbb',
          cpuPercent: null,
          memoryMb: null,
          status: 'exited'
        }
      ],
      git: {
        branch: 'feature/left-rail',
        additions: 12,
        deletions: 4,
        changedFiles: 3
      }
    },
    56,
    16
  );

  assert.equal(rows.length, 16);
  assert.equal(rows.some((row) => row.includes('DIR')), true);
  assert.equal(rows.some((row) => row.includes('CONV')), true);
  assert.equal(rows.some((row) => row.includes('PROC')), true);
  assert.equal(rows.some((row) => row.includes('GIT')), true);
  assert.equal(rows.some((row) => row.includes('NEED bbbbbbbb approval')), true);
  assert.equal(rows.some((row) => row.includes('RUN codex aaaaaaaa')), true);
  assert.equal(rows.some((row) => row.includes('EXIT codex bbbbbbbb')), true);
  assert.equal(rows.some((row) => row.includes('feature/left-rail')), true);
  assert.equal(rows.some((row) => row.includes('+12 -4 | 3 files')), true);
  assert.equal(rows.some((row) => row.includes('\u001b[0;38;5;255;48;5;238m')), true);
});

void test('workspace rail handles empty state truncation and tiny dimensions', () => {
  const rows = renderWorkspaceRailAnsiRows(
    {
      directories: [],
      conversations: [],
      activeConversationId: null,
      processes: [],
      git: {
        branch: 'HEAD',
        additions: 0,
        deletions: 0,
        changedFiles: 0
      }
    },
    8,
    4
  );
  assert.equal(rows.length, 4);
  assert.equal(rows[0]?.includes('DIR'), true);

  const narrow = renderWorkspaceRailAnsiRows(
    {
      directories: [
        {
          key: 'x',
          workspaceId: 'workspace-name',
          worktreeId: 'branch-name',
          active: false
        }
      ],
      conversations: [
        {
          sessionId: 'conversation-1234567890',
          status: 'exited',
          attentionReason: null,
          live: false,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: null
        },
        {
          sessionId: 'conversation-12345678',
          status: 'running',
          attentionReason: '',
          live: true,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:01.000Z'
        },
        {
          sessionId: 'short-id',
          status: 'completed',
          attentionReason: null,
          live: true,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: null
        }
      ],
      activeConversationId: null,
      processes: [
        {
          key: 'p',
          label: 'proc',
          cpuPercent: 0,
          memoryMb: 0,
          status: 'running'
        }
      ],
      git: {
        branch: 'topic',
        additions: 1,
        deletions: 2,
        changedFiles: 3
      }
    },
    1,
    10
  );
  assert.equal(narrow.length, 10);
  assert.equal(narrow.every((line) => line.length > 0), true);
});
