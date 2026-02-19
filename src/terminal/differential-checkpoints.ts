import {
  diffTerminalFrames,
  replayTerminalSteps,
  type TerminalSnapshotFrame,
} from './snapshot-oracle.ts';

export type TerminalDifferentialStep =
  | {
      kind: 'output';
      chunk: string;
    }
  | {
      kind: 'resize';
      cols: number;
      rows: number;
    };

export interface TerminalDifferentialCheckpoint {
  readonly id: string;
  readonly stepIndex: number;
  readonly directFrameHash: string;
  readonly directFrame?: TerminalSnapshotFrame;
}

export interface TerminalDifferentialCase {
  readonly id: string;
  readonly cols: number;
  readonly rows: number;
  readonly steps: readonly TerminalDifferentialStep[];
  readonly checkpoints: readonly TerminalDifferentialCheckpoint[];
}

export interface TerminalDifferentialCheckpointResult {
  readonly id: string;
  readonly pass: boolean;
  readonly harnessFrameHash: string | null;
  readonly directFrameHash: string;
  readonly reasons: readonly string[];
}

export interface TerminalDifferentialCaseResult {
  readonly id: string;
  readonly pass: boolean;
  readonly checkpointResults: readonly TerminalDifferentialCheckpointResult[];
}

export interface TerminalDifferentialSuiteResult {
  readonly pass: boolean;
  readonly totalCases: number;
  readonly passedCases: number;
  readonly failedCases: number;
  readonly totalCheckpoints: number;
  readonly failedCheckpoints: number;
  readonly caseResults: readonly TerminalDifferentialCaseResult[];
}

function evaluateCheckpoint(
  checkpoint: TerminalDifferentialCheckpoint,
  harnessFrame: TerminalSnapshotFrame | undefined,
): TerminalDifferentialCheckpointResult {
  if (harnessFrame === undefined) {
    return {
      id: checkpoint.id,
      pass: false,
      harnessFrameHash: null,
      directFrameHash: checkpoint.directFrameHash,
      reasons: ['checkpoint-step-missing'],
    };
  }

  const reasons: string[] = [];
  if (harnessFrame.frameHash !== checkpoint.directFrameHash) {
    reasons.push('frame-hash-mismatch');
  }

  if (checkpoint.directFrame !== undefined) {
    const frameDiff = diffTerminalFrames(checkpoint.directFrame, harnessFrame);
    if (!frameDiff.equal) {
      for (const reason of frameDiff.reasons) {
        reasons.push(`frame-diff:${reason}`);
      }
    }
  }

  return {
    id: checkpoint.id,
    pass: reasons.length === 0,
    harnessFrameHash: harnessFrame.frameHash,
    directFrameHash: checkpoint.directFrameHash,
    reasons,
  };
}

export function runTerminalDifferentialCase(
  scenario: TerminalDifferentialCase,
): TerminalDifferentialCaseResult {
  const frames = replayTerminalSteps(scenario.steps, scenario.cols, scenario.rows);
  const checkpointResults = scenario.checkpoints.map((checkpoint) =>
    evaluateCheckpoint(checkpoint, frames[checkpoint.stepIndex]),
  );
  return {
    id: scenario.id,
    pass: checkpointResults.every((result) => result.pass),
    checkpointResults,
  };
}

export function runTerminalDifferentialSuite(
  scenarios: readonly TerminalDifferentialCase[],
): TerminalDifferentialSuiteResult {
  const caseResults = scenarios.map((scenario) => runTerminalDifferentialCase(scenario));
  const passedCases = caseResults.filter((result) => result.pass).length;
  const totalCheckpoints = caseResults.reduce(
    (count, result) => count + result.checkpointResults.length,
    0,
  );
  const failedCheckpoints = caseResults.reduce(
    (count, result) =>
      count + result.checkpointResults.filter((checkpoint) => !checkpoint.pass).length,
    0,
  );

  return {
    pass: passedCases === caseResults.length,
    totalCases: caseResults.length,
    passedCases,
    failedCases: caseResults.length - passedCases,
    totalCheckpoints,
    failedCheckpoints,
    caseResults,
  };
}
