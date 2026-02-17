import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { resolveMuxShortcutBindings } from '../src/mux/input-shortcuts.ts';
import { buildRailModel, buildRailRows } from '../src/mux/live-mux/rail-layout.ts';

const ESC = String.fromCharCode(27);
const ANSI_CSI_PATTERN = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'gu');

function stripAnsi(value: string): string {
  return value.replace(ANSI_CSI_PATTERN, '');
}

const LAYOUT = {
  leftCols: 160,
  paneRows: 24,
};

const LOADING_GIT_SUMMARY = {
  branch: '(loading)',
  changedFiles: 0,
  additions: 0,
  deletions: 0,
} as const;

void test('live-mux rail layout infers untracked directories from conversation-only rows', () => {
  const rows = buildRailRows({
    layout: LAYOUT,
    repositories: new Map([
      [
        'repo-1',
        {
          repositoryId: 'repo-1',
          name: 'repo-one',
          remoteUrl: 'https://github.com/example/repo-one',
        },
      ],
    ]),
    repositoryAssociationByDirectoryId: new Map([['dir-1', 'repo-1']]),
    directoryRepositorySnapshotByDirectoryId: new Map(),
    directories: new Map([
      [
        'dir-1',
        {
          directoryId: 'dir-1',
          path: '/tmp/dir-1',
        },
      ],
    ]),
    conversations: new Map([
      [
        'session-1',
        {
          sessionId: 'session-1',
          directoryId: 'dir-1',
          title: 'thread-1',
          agentType: 'codex',
          status: 'running',
          attentionReason: null,
          live: true,
          startedAt: '2026-02-17T00:00:00.000Z',
          lastEventAt: '2026-02-17T00:00:01.000Z',
          lastKnownWork: 'active',
          lastKnownWorkAt: '2026-02-17T00:00:01.000Z',
          controller: null,
        },
      ],
      [
        'session-untracked',
        {
          sessionId: 'session-untracked',
          directoryId: 'dir-untracked',
          title: 'thread-untracked',
          agentType: 'terminal',
          status: 'completed',
          attentionReason: null,
          live: false,
          startedAt: '2026-02-17T00:00:00.000Z',
          lastEventAt: '2026-02-17T00:00:02.000Z',
          lastKnownWork: 'inactive',
          lastKnownWorkAt: '2026-02-17T00:00:02.000Z',
          controller: null,
        },
      ],
    ]),
    orderedIds: ['session-1', 'session-untracked'],
    activeProjectId: 'dir-1',
    activeRepositoryId: 'repo-1',
    activeConversationId: 'session-1',
    projectSelectionEnabled: true,
    repositorySelectionEnabled: false,
    homeSelectionEnabled: false,
    repositoriesCollapsed: false,
    collapsedRepositoryGroupIds: new Set<string>(),
    shortcutsCollapsed: false,
    gitSummaryByDirectoryId: new Map(),
    processUsageBySessionId: new Map(),
    shortcutBindings: resolveMuxShortcutBindings({}),
    loadingGitSummary: LOADING_GIT_SUMMARY,
  });

  const visible = rows.ansiRows.map(stripAnsi).join('\n');
  assert.equal(rows.ansiRows.length, LAYOUT.paneRows);
  assert.equal(visible.includes('(untracked)'), true);
  assert.equal(visible.includes('thread-untracked'), true);
});

void test('live-mux rail model uses loading git summary fallback when project summary is missing', () => {
  const model = buildRailModel({
    repositories: new Map(),
    repositoryAssociationByDirectoryId: new Map(),
    directoryRepositorySnapshotByDirectoryId: new Map(),
    directories: new Map([
      [
        'dir-loading',
        {
          directoryId: 'dir-loading',
          path: '/tmp/dir-loading',
        },
      ],
    ]),
    conversations: new Map(),
    orderedIds: [],
    activeProjectId: 'dir-loading',
    activeRepositoryId: null,
    activeConversationId: null,
    projectSelectionEnabled: true,
    repositorySelectionEnabled: false,
    homeSelectionEnabled: false,
    repositoriesCollapsed: false,
    collapsedRepositoryGroupIds: new Set<string>(),
    shortcutsCollapsed: false,
    gitSummaryByDirectoryId: new Map(),
    processUsageBySessionId: new Map(),
    shortcutBindings: resolveMuxShortcutBindings({}),
    loadingGitSummary: LOADING_GIT_SUMMARY,
  });

  const loadingDirectory = model.directories.find((directory) => directory.key === 'dir-loading');
  assert.equal(loadingDirectory?.git.branch, '(loading)');
});

void test('live-mux rail layout shortcut hint collapses next/previous into single token when equal', () => {
  const rows = buildRailRows({
    layout: LAYOUT,
    repositories: new Map(),
    repositoryAssociationByDirectoryId: new Map(),
    directoryRepositorySnapshotByDirectoryId: new Map(),
    directories: new Map(),
    conversations: new Map(),
    orderedIds: [],
    activeProjectId: null,
    activeRepositoryId: null,
    activeConversationId: null,
    projectSelectionEnabled: false,
    repositorySelectionEnabled: false,
    homeSelectionEnabled: true,
    repositoriesCollapsed: false,
    collapsedRepositoryGroupIds: new Set<string>(),
    shortcutsCollapsed: false,
    gitSummaryByDirectoryId: new Map(),
    processUsageBySessionId: new Map(),
    shortcutBindings: resolveMuxShortcutBindings({
      'mux.conversation.next': ['ctrl+n'],
      'mux.conversation.previous': ['ctrl+n'],
    }),
    loadingGitSummary: LOADING_GIT_SUMMARY,
  });

  const visible = rows.ansiRows.map(stripAnsi).join('\n');
  assert.equal(visible.includes('ctrl+n switch nav'), true);
  assert.equal(visible.includes('ctrl+n/ctrl+n switch nav'), false);
});
