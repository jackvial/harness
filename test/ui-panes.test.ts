import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { TerminalSnapshotOracle } from '../src/terminal/snapshot-oracle.ts';
import { createTaskComposerBuffer } from '../src/mux/task-composer.ts';
import { resolveMuxShortcutBindings } from '../src/mux/input-shortcuts.ts';
import { ConversationPane } from '../src/ui/panes/conversation.ts';
import { HomePane } from '../src/ui/panes/home.ts';
import { ProjectPane } from '../src/ui/panes/project.ts';
import { LeftRailPane } from '../src/ui/panes/left-rail.ts';
import type { ProjectPaneSnapshot } from '../src/mux/harness-core-ui.ts';

void test('conversation pane renders rows from terminal snapshot frame', () => {
  const oracle = new TerminalSnapshotOracle(12, 3);
  oracle.ingest('hello');
  const frame = oracle.snapshotWithoutHash();
  const pane = new ConversationPane();
  const rows = pane.render(frame, {
    rightCols: 12,
    paneRows: 3,
  });
  assert.equal(rows.length, 3);
});

void test('home pane renders task-focused view from repositories and tasks', () => {
  const pane = new HomePane();
  const view = pane.render({
    layout: {
      rightCols: 40,
      paneRows: 8,
    },
    repositories: new Map([
      [
        'repo-1',
        {
          repositoryId: 'repo-1',
          name: 'Harness',
          archivedAt: null,
        },
      ],
    ]),
    tasks: new Map([
      [
        'task-1',
        {
          taskId: 'task-1',
          repositoryId: 'repo-1',
          title: 'Wire pane',
          description: 'keep behavior',
          status: 'ready',
          orderIndex: 0,
          createdAt: '2026-02-18T00:00:00.000Z',
        },
      ],
    ]),
    selectedRepositoryId: null,
    repositoryDropdownOpen: false,
    editorTarget: { kind: 'draft' },
    draftBuffer: createTaskComposerBuffer(''),
    taskBufferById: new Map(),
    notice: null,
    scrollTop: 0,
  });
  assert.equal(view.rows.length, 8);
  assert.equal(view.selectedRepositoryId, 'repo-1');
});

void test('project pane renders blank fallback and snapshot rows', () => {
  const pane = new ProjectPane();
  const layout = {
    rightCols: 18,
    paneRows: 3,
  };
  const blank = pane.render({
    layout,
    snapshot: null,
    scrollTop: 2,
  });
  assert.equal(blank.rows.length, 3);
  assert.equal(blank.scrollTop, 2);

  const snapshot: ProjectPaneSnapshot = {
    directoryId: 'dir-1',
    path: '/tmp/project',
    lines: ['project test', 'path /tmp/project'],
    actionLineIndexByKind: {
      conversationNew: 0,
      projectClose: 1,
    },
  };
  const rendered = pane.render({
    layout,
    snapshot,
    scrollTop: 0,
  });
  assert.equal(rendered.rows.length, 3);
  assert.equal(rendered.scrollTop, 0);
});

void test('left rail pane delegates row rendering through rail-layout model', () => {
  const pane = new LeftRailPane();
  const result = pane.render({
    layout: {
      leftCols: 30,
      paneRows: 5,
    },
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
    collapsedRepositoryGroupIds: new Set(),
    shortcutsCollapsed: false,
    gitSummaryByDirectoryId: new Map(),
    processUsageBySessionId: new Map(),
    shortcutBindings: resolveMuxShortcutBindings(),
    loadingGitSummary: {
      branch: 'loading',
      changedFiles: 0,
      additions: 0,
      deletions: 0,
    },
  });
  assert.equal(result.ansiRows.length, 5);
  assert.equal(result.viewRows.length > 0, true);
});
