import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  runTerminalDifferentialSuite,
  type TerminalDifferentialCase,
  type TerminalDifferentialCheckpoint,
  type TerminalDifferentialStep,
} from '../src/terminal/differential-checkpoints.ts';

interface Args {
  fixturePath: string;
  json: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  let fixturePath = 'assets/terminal-differential-checkpoints.json';
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--fixture') {
      fixturePath = argv[index + 1] ?? fixturePath;
      index += 1;
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
  }

  return {
    fixturePath: resolve(process.cwd(), fixturePath),
    json,
  };
}

function asStep(value: unknown): TerminalDifferentialStep | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const candidate = value as {
    kind?: unknown;
    chunk?: unknown;
    cols?: unknown;
    rows?: unknown;
  };

  if (candidate.kind === 'output' && typeof candidate.chunk === 'string') {
    return { kind: 'output', chunk: candidate.chunk };
  }
  if (
    candidate.kind === 'resize' &&
    typeof candidate.cols === 'number' &&
    Number.isInteger(candidate.cols) &&
    candidate.cols > 0 &&
    typeof candidate.rows === 'number' &&
    Number.isInteger(candidate.rows) &&
    candidate.rows > 0
  ) {
    return {
      kind: 'resize',
      cols: candidate.cols,
      rows: candidate.rows,
    };
  }

  return null;
}

function asCheckpoint(value: unknown): TerminalDifferentialCheckpoint | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const candidate = value as {
    id?: unknown;
    stepIndex?: unknown;
    directFrameHash?: unknown;
  };

  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.stepIndex !== 'number' ||
    !Number.isInteger(candidate.stepIndex) ||
    candidate.stepIndex < 0 ||
    typeof candidate.directFrameHash !== 'string'
  ) {
    return null;
  }

  return {
    id: candidate.id,
    stepIndex: candidate.stepIndex,
    directFrameHash: candidate.directFrameHash,
  };
}

function asCase(value: unknown): TerminalDifferentialCase | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const candidate = value as {
    id?: unknown;
    cols?: unknown;
    rows?: unknown;
    steps?: unknown;
    checkpoints?: unknown;
  };

  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.cols !== 'number' ||
    !Number.isInteger(candidate.cols) ||
    candidate.cols <= 0 ||
    typeof candidate.rows !== 'number' ||
    !Number.isInteger(candidate.rows) ||
    candidate.rows <= 0 ||
    !Array.isArray(candidate.steps) ||
    !Array.isArray(candidate.checkpoints)
  ) {
    return null;
  }

  const steps = candidate.steps.map((step) => asStep(step));
  const checkpoints = candidate.checkpoints.map((checkpoint) => asCheckpoint(checkpoint));
  if (
    steps.some((step) => step === null) ||
    checkpoints.some((checkpoint) => checkpoint === null)
  ) {
    return null;
  }

  return {
    id: candidate.id,
    cols: candidate.cols,
    rows: candidate.rows,
    steps: steps as TerminalDifferentialStep[],
    checkpoints: checkpoints as TerminalDifferentialCheckpoint[],
  };
}

function parseFixture(text: string): TerminalDifferentialCase[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `failed to parse differential fixture JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error('differential fixture must be a JSON array of cases');
  }

  const scenarios = parsed.map((entry) => asCase(entry));
  const invalidIndex = scenarios.findIndex((entry) => entry === null);
  if (invalidIndex !== -1) {
    throw new Error(`invalid differential case at index ${String(invalidIndex)}`);
  }
  return scenarios as TerminalDifferentialCase[];
}

function main(argv: readonly string[]): number {
  const args = parseArgs(argv);
  const fileText = readFileSync(args.fixturePath, 'utf8');
  const scenarios = parseFixture(fileText);
  const result = runTerminalDifferentialSuite(scenarios);

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    process.stdout.write(
      `terminal-differential: pass=${String(result.pass)} cases=${String(result.totalCases)} failed-cases=${String(result.failedCases)} checkpoints=${String(result.totalCheckpoints)} failed-checkpoints=${String(result.failedCheckpoints)}\n`,
    );
    for (const caseResult of result.caseResults) {
      process.stdout.write(
        `[${caseResult.pass ? 'PASS' : 'FAIL'}] case=${caseResult.id} checkpoints=${String(caseResult.checkpointResults.length)}\n`,
      );
      for (const checkpoint of caseResult.checkpointResults) {
        if (checkpoint.pass) {
          continue;
        }
        process.stdout.write(
          `  checkpoint=${checkpoint.id} reasons=${checkpoint.reasons.join(',')} harnessHash=${String(checkpoint.harnessFrameHash)} directHash=${checkpoint.directFrameHash}\n`,
        );
      }
    }
  }

  return result.pass ? 0 : 1;
}

process.exitCode = main(process.argv.slice(2));
