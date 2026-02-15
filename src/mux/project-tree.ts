import { execFileSync } from 'node:child_process';
import { readdirSync, type Dirent } from 'node:fs';
import { basename, join } from 'node:path';

const DEFAULT_PROJECT_TREE_MAX_DEPTH = 3;
const DEFAULT_PROJECT_TREE_MAX_ENTRIES = 240;
const DEFAULT_PROJECT_TREE_SKIP_NAMES = new Set<string>([
  '.git',
  'node_modules',
  '.next',
  '.turbo',
  'dist',
  'build',
  'target'
]);
const PROJECT_TREE_KIND_SORT_WEIGHT: Record<ProjectTreeDirectoryEntry['kind'], string> = {
  directory: '0',
  file: '1',
  symlink: '1'
};

export interface ProjectTreeDirectoryEntry {
  readonly name: string;
  readonly kind: 'directory' | 'file' | 'symlink';
}

type GitLsFilesRunner = (cwd: string, args: readonly string[]) => string | null;
type ReadDirectoryEntries = (path: string) => readonly ProjectTreeDirectoryEntry[];

interface BuildProjectTreeLinesOptions {
  readonly maxDepth?: number;
  readonly maxEntries?: number;
  readonly skipNames?: ReadonlySet<string> | readonly string[];
  readonly runGitLsFiles?: GitLsFilesRunner;
  readonly readDirectoryEntries?: ReadDirectoryEntries;
}

interface ProjectTreeEmitState {
  readonly lines: string[];
  readonly maxDepth: number;
  readonly maxEntries: number;
  emitted: number;
  truncated: boolean;
}

interface GitTreeNode {
  readonly directories: Map<string, GitTreeNode>;
  readonly files: Set<string>;
}

function formatProjectTreeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function toPositiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return Math.floor(value);
}

function resolveSkipNames(
  value: ReadonlySet<string> | readonly string[] | undefined
): ReadonlySet<string> {
  if (value === undefined) {
    return DEFAULT_PROJECT_TREE_SKIP_NAMES;
  }
  if (value instanceof Set) {
    return value;
  }
  return new Set(value);
}

function mapDirentToProjectTreeEntry(entry: Dirent): ProjectTreeDirectoryEntry {
  if (entry.isDirectory()) {
    return {
      name: entry.name,
      kind: 'directory'
    };
  }
  if (entry.isSymbolicLink()) {
    return {
      name: entry.name,
      kind: 'symlink'
    };
  }
  return {
    name: entry.name,
    kind: 'file'
  };
}

function readDirectoryEntriesFromFilesystem(path: string): readonly ProjectTreeDirectoryEntry[] {
  return readdirSync(path, { withFileTypes: true }).map(mapDirentToProjectTreeEntry);
}

function sortProjectTreeEntries(
  entries: readonly ProjectTreeDirectoryEntry[]
): ProjectTreeDirectoryEntry[] {
  return [...entries].sort((left, right) => {
    const leftKey = `${PROJECT_TREE_KIND_SORT_WEIGHT[left.kind]}:${left.name}`;
    const rightKey = `${PROJECT_TREE_KIND_SORT_WEIGHT[right.kind]}:${right.name}`;
    return leftKey.localeCompare(rightKey);
  });
}

function runGitLsFilesSync(cwd: string, args: readonly string[]): string | null {
  try {
    return execFileSync('git', [...args], {
      cwd,
      encoding: 'utf8',
      timeout: 1500,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore']
    });
  } catch {
    return null;
  }
}

function parseGitLsFilesOutput(output: string): readonly string[] {
  if (output.length === 0) {
    return [];
  }
  return output.split('\0').filter((entry) => entry.length > 0);
}

function createGitTreeNode(): GitTreeNode {
  return {
    directories: new Map<string, GitTreeNode>(),
    files: new Set<string>()
  };
}

function insertGitTreePath(root: GitTreeNode, value: string): void {
  const normalized = value
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');
  if (normalized.length === 0) {
    return;
  }
  const segments = normalized.split('/').filter((segment) => segment.length > 0);
  let current = root;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    const last = index === segments.length - 1;
    if (last) {
      current.files.add(segment);
      continue;
    }
    let next = current.directories.get(segment);
    if (next === undefined) {
      next = createGitTreeNode();
      current.directories.set(segment, next);
    }
    current = next;
  }
}

function emitProjectTreeLine(state: ProjectTreeEmitState, line: string): boolean {
  if (state.truncated) {
    return false;
  }
  state.lines.push(line);
  state.emitted += 1;
  if (state.emitted >= state.maxEntries) {
    state.truncated = true;
    return false;
  }
  return true;
}

function walkGitTree(
  node: GitTreeNode,
  depth: number,
  prefix: string,
  state: ProjectTreeEmitState
): void {
  if (depth >= state.maxDepth) {
    return;
  }
  const directories = [...node.directories.keys()].sort((left, right) => left.localeCompare(right));
  const files = [...node.files.values()].sort((left, right) => left.localeCompare(right));
  const entries = [
    ...directories.map((name) => ({ kind: 'directory' as const, name })),
    ...files.map((name) => ({ kind: 'file' as const, name }))
  ];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const isLast = index === entries.length - 1;
    const connector = isLast ? '└─ ' : '├─ ';
    const suffix = entry.kind === 'directory' ? '/' : '';
    if (!emitProjectTreeLine(state, `${prefix}${connector}${entry.name}${suffix}`)) {
      return;
    }
    if (entry.kind !== 'directory') {
      continue;
    }
    const child = node.directories.get(entry.name)!;
    walkGitTree(child, depth + 1, `${prefix}${isLast ? '   ' : '│  '}`, state);
  }
}

function walkFilesystemTree(
  currentPath: string,
  depth: number,
  prefix: string,
  skipNames: ReadonlySet<string>,
  readDirectoryEntries: ReadDirectoryEntries,
  state: ProjectTreeEmitState
): void {
  if (depth >= state.maxDepth) {
    return;
  }
  let entries: ProjectTreeDirectoryEntry[];
  try {
    entries = sortProjectTreeEntries(
      readDirectoryEntries(currentPath).filter((entry) => !skipNames.has(entry.name))
    );
  } catch (error: unknown) {
    void emitProjectTreeLine(
      state,
      `${prefix}└─ [unreadable: ${formatProjectTreeError(error)}]`
    );
    return;
  }
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const isLast = index === entries.length - 1;
    const connector = isLast ? '└─ ' : '├─ ';
    const suffix = entry.kind === 'directory' ? '/' : entry.kind === 'symlink' ? '@' : '';
    if (!emitProjectTreeLine(state, `${prefix}${connector}${entry.name}${suffix}`)) {
      return;
    }
    if (entry.kind !== 'directory') {
      continue;
    }
    walkFilesystemTree(
      join(currentPath, entry.name),
      depth + 1,
      `${prefix}${isLast ? '   ' : '│  '}`,
      skipNames,
      readDirectoryEntries,
      state
    );
  }
}

function finalizeProjectTreeLines(state: ProjectTreeEmitState): readonly string[] {
  if (state.truncated) {
    state.lines.push('└─ …');
  }
  return state.lines;
}

export function buildProjectTreeLines(
  rootPath: string,
  options: BuildProjectTreeLinesOptions = {}
): readonly string[] {
  const rootLabel = basename(rootPath) || rootPath;
  const lines: string[] = [`${rootLabel}/`];
  const state: ProjectTreeEmitState = {
    lines,
    maxDepth: toPositiveInt(options.maxDepth, DEFAULT_PROJECT_TREE_MAX_DEPTH),
    maxEntries: Math.max(1, toPositiveInt(options.maxEntries, DEFAULT_PROJECT_TREE_MAX_ENTRIES)),
    emitted: 0,
    truncated: false
  };
  const runGitLsFiles = options.runGitLsFiles ?? runGitLsFilesSync;
  const gitOutput = runGitLsFiles(rootPath, [
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '-z'
  ]);
  if (gitOutput !== null) {
    const root = createGitTreeNode();
    for (const path of parseGitLsFilesOutput(gitOutput)) {
      insertGitTreePath(root, path);
    }
    walkGitTree(root, 0, '', state);
    return finalizeProjectTreeLines(state);
  }
  walkFilesystemTree(
    rootPath,
    0,
    '',
    resolveSkipNames(options.skipNames),
    options.readDirectoryEntries ?? readDirectoryEntriesFromFilesystem,
    state
  );
  return finalizeProjectTreeLines(state);
}
