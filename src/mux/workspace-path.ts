import { join, resolve, sep } from 'node:path';

function stripWrappingQuotes(value: string): string {
  if (value.length < 2) {
    return value;
  }
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }
  return value;
}

export function normalizeWorkspacePathInput(value: string): string {
  const trimmed = value.trim();
  const withoutPrefix = trimmed.toLowerCase().startsWith('path:')
    ? trimmed.slice('path:'.length).trim()
    : trimmed;
  return stripWrappingQuotes(withoutPrefix.trim());
}

export function expandHomePath(value: string, homeDirectory: string | null): string {
  const normalized = normalizeWorkspacePathInput(value);
  if (homeDirectory === null || homeDirectory.length === 0) {
    return normalized;
  }
  if (normalized === '~') {
    return homeDirectory;
  }
  if (normalized.startsWith('~/')) {
    return join(homeDirectory, normalized.slice(2));
  }
  return normalized;
}

export function resolveWorkspacePath(
  invocationDirectory: string,
  value: string,
  homeDirectory: string | null,
): string {
  const resolvedInvocation = resolve(invocationDirectory);
  const expanded = expandHomePath(value, homeDirectory);
  if (homeDirectory !== null && homeDirectory.length > 0) {
    const invocationTildePrefix = `${resolvedInvocation}${sep}~`;
    if (expanded === invocationTildePrefix) {
      return homeDirectory;
    }
    const invocationTildePathPrefix = `${invocationTildePrefix}${sep}`;
    if (expanded.startsWith(invocationTildePathPrefix)) {
      return resolve(homeDirectory, expanded.slice(invocationTildePathPrefix.length));
    }
  }
  return resolve(resolvedInvocation, expanded);
}
