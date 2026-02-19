import { spawnSync } from 'node:child_process';

export const BUN_INSTALL_DOCS_URL = 'https://bun.sh/docs/installation';

export function formatBunRequiredMessage() {
  return [
    '[harness] Bun is required to install and run Harness.',
    `[harness] install Bun: ${BUN_INSTALL_DOCS_URL}`,
    '[harness] then verify: bun --version',
  ].join('\n');
}

export function isBunAvailable(command = 'bun') {
  const check = spawnSync(command, ['--version'], {
    stdio: 'ignore',
  });
  return check.status === 0;
}

export function ensureBunAvailable(options = {}) {
  const command =
    typeof options.command === 'string' && options.command.trim().length > 0
      ? options.command.trim()
      : 'bun';
  const stderr = options.stderr ?? process.stderr;
  if (isBunAvailable(command)) {
    return true;
  }
  stderr.write(`${formatBunRequiredMessage()}\n`);
  const onMissing = options.onMissing;
  if (typeof onMissing === 'function') {
    onMissing();
  }
  return false;
}
