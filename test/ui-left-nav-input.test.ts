import assert from 'node:assert/strict';
import { test } from 'bun:test';
import type { LeftNavSelection } from '../src/mux/live-mux/left-nav.ts';
import { LeftNavInput } from '../src/ui/left-nav-input.ts';

interface Harness {
  readonly input: LeftNavInput;
  readonly calls: string[];
  readonly setSelection: (selection: LeftNavSelection) => void;
  readonly setRows: (rows: readonly LeftNavSelection[]) => void;
}

function createInjectedHarness(): Harness {
  let selection: LeftNavSelection = { kind: 'home' };
  let rows: readonly LeftNavSelection[] = [];
  const calls: string[] = [];
  const input = new LeftNavInput(
    {
      getLatestRailRows: () => [] as never,
      getCurrentSelection: () => selection,
      enterHomePane: () => {
        calls.push('enter-home');
      },
      firstDirectoryForRepositoryGroup: () => 'dir-a',
      enterProjectPane: () => {
        calls.push('enter-project');
      },
      setMainPaneProjectMode: () => {
        calls.push('set-project-mode');
      },
      selectLeftNavRepository: () => {
        calls.push('select-repo');
      },
      markDirty: () => {
        calls.push('mark-dirty');
      },
      directoriesHas: () => true,
      conversationDirectoryId: () => null,
      queueControlPlaneOp: () => {
        calls.push('queue-op');
      },
      activateConversation: async () => {},
      conversationsHas: () => true,
    },
    {
      visibleLeftNavTargets: () => rows,
      activateLeftNavTarget: (options) => {
        calls.push(`visible:${options.visibleTargetsForState().length}`);
        calls.push(`activate:${options.target.kind}:${options.direction}`);
      },
      cycleLeftNavSelection: (options) => {
        calls.push(`cycle:${options.direction}`);
        const target = options.visibleTargets[0];
        if (target === undefined) {
          return false;
        }
        options.activateTarget(target, options.direction);
        return true;
      },
    },
  );
  return {
    input,
    calls,
    setSelection: (next) => {
      selection = next;
    },
    setRows: (next) => {
      rows = next;
    },
  };
}

void test('left-nav input uses injected dependencies for activation and cycling', () => {
  const harness = createInjectedHarness();
  harness.setRows([
    { kind: 'project', directoryId: 'dir-a' },
    { kind: 'conversation', sessionId: 'session-a' },
  ]);
  harness.setSelection({ kind: 'repository', repositoryId: 'repo-a' });

  assert.deepEqual(harness.input.visibleTargets(), [
    { kind: 'project', directoryId: 'dir-a' },
    { kind: 'conversation', sessionId: 'session-a' },
  ]);
  harness.input.activateTarget({ kind: 'home' }, 'next');
  const cycled = harness.input.cycleSelection('previous');

  assert.equal(cycled, true);
  assert.deepEqual(harness.calls, [
    'visible:2',
    'activate:home:next',
    'cycle:previous',
    'visible:2',
    'activate:project:previous',
  ]);
});

void test('left-nav input default dependencies cover activation and empty cycle path', () => {
  let selection: LeftNavSelection = { kind: 'home' };
  let enteredHome = 0;
  const input = new LeftNavInput({
    getLatestRailRows: () => [] as never,
    getCurrentSelection: () => selection,
    enterHomePane: () => {
      enteredHome += 1;
    },
    firstDirectoryForRepositoryGroup: () => null,
    enterProjectPane: () => {},
    setMainPaneProjectMode: () => {},
    selectLeftNavRepository: () => {},
    markDirty: () => {},
    directoriesHas: () => false,
    conversationDirectoryId: () => null,
    queueControlPlaneOp: () => {},
    activateConversation: async () => {},
    conversationsHas: () => false,
  });

  assert.deepEqual(input.visibleTargets(), []);
  input.activateTarget({ kind: 'home' }, 'next');
  assert.equal(enteredHome, 1);

  selection = { kind: 'repository', repositoryId: 'repo-a' };
  assert.equal(input.cycleSelection('next'), false);
});
