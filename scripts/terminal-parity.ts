import {
  TERMINAL_PARITY_SCENES,
  runTerminalParityMatrix
} from '../src/terminal/parity-suite.ts';

function summarizeScene(result: ReturnType<typeof runTerminalParityMatrix>['results'][number]): string {
  const status = result.pass ? 'PASS' : 'FAIL';
  const suffix = result.pass ? '' : ` failures=${result.failures.join(',')}`;
  return `[${status}] profile=${result.profile} scene=${result.sceneId} hash=${result.frameHash}${suffix}`;
}

function summarizeMatrix(result: ReturnType<typeof runTerminalParityMatrix>): string {
  return `terminal-parity: pass=${String(result.pass)} scenes=${String(result.totalScenes)} passed=${String(result.passedScenes)} failed=${String(result.failedScenes)}`;
}

function main(): number {
  const json = process.argv.includes('--json');
  const matrix = runTerminalParityMatrix(TERMINAL_PARITY_SCENES);

  if (json) {
    process.stdout.write(`${JSON.stringify(matrix)}\n`);
  } else {
    process.stdout.write(`${summarizeMatrix(matrix)}\n`);
    for (const scene of matrix.results) {
      process.stdout.write(`${summarizeScene(scene)}\n`);
    }
  }

  return matrix.pass ? 0 : 1;
}

const code = main();
process.exitCode = code;
