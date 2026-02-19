import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { HARNESS_CONFIG_FILE_NAME, resolveHarnessConfigDirectory } from './config-core.ts';
import {
  resolveHarnessWorkspaceDirectory,
  resolveLegacyHarnessDirectory,
} from './harness-paths.ts';

const LEGACY_SECRETS_FILE_NAME = 'secrets.env';
const MIGRATION_MARKER_FILE_NAME = '.legacy-layout-migration-v1';
const LEGACY_RUNTIME_EXCLUDE_NAMES = new Set([
  HARNESS_CONFIG_FILE_NAME,
  LEGACY_SECRETS_FILE_NAME,
  'workspaces',
]);

interface HarnessLegacyLayoutMigrationResult {
  readonly migrated: boolean;
  readonly migratedEntries: number;
  readonly configCopied: boolean;
  readonly secretsCopied: boolean;
  readonly skipped: boolean;
  readonly markerPath: string;
}

function copyFileIfMissing(sourcePath: string, targetPath: string): boolean {
  if (!existsSync(sourcePath) || existsSync(targetPath)) {
    return false;
  }
  mkdirSync(dirname(targetPath), { recursive: true });
  copyFileSync(sourcePath, targetPath);
  return true;
}

function copyEntryIfMissing(sourcePath: string, targetPath: string): boolean {
  if (!existsSync(sourcePath)) {
    return false;
  }
  const targetExisted = existsSync(targetPath);
  mkdirSync(dirname(targetPath), { recursive: true });
  cpSync(sourcePath, targetPath, {
    recursive: true,
    force: false,
    errorOnExist: false,
  });
  return !targetExisted;
}

function writeMigrationMarker(markerPath: string): void {
  mkdirSync(dirname(markerPath), { recursive: true });
  writeFileSync(markerPath, `${new Date().toISOString()}\n`, 'utf8');
}

export function migrateLegacyHarnessLayout(
  invocationDirectory: string,
  env: NodeJS.ProcessEnv = process.env,
): HarnessLegacyLayoutMigrationResult {
  const legacyRoot = resolveLegacyHarnessDirectory(invocationDirectory);
  const configDirectory = resolveHarnessConfigDirectory(invocationDirectory, env);
  const workspaceDirectory = resolveHarnessWorkspaceDirectory(invocationDirectory, env);
  const markerPath = resolve(workspaceDirectory, MIGRATION_MARKER_FILE_NAME);

  const configCopied = copyFileIfMissing(
    resolve(legacyRoot, HARNESS_CONFIG_FILE_NAME),
    resolve(configDirectory, HARNESS_CONFIG_FILE_NAME),
  );
  const secretsCopied = copyFileIfMissing(
    resolve(legacyRoot, LEGACY_SECRETS_FILE_NAME),
    resolve(configDirectory, LEGACY_SECRETS_FILE_NAME),
  );

  if (resolve(configDirectory) === legacyRoot) {
    return {
      migrated: configCopied || secretsCopied,
      migratedEntries: 0,
      configCopied,
      secretsCopied,
      skipped: true,
      markerPath,
    };
  }

  if (!existsSync(legacyRoot)) {
    return {
      migrated: configCopied || secretsCopied,
      migratedEntries: 0,
      configCopied,
      secretsCopied,
      skipped: true,
      markerPath,
    };
  }

  if (existsSync(markerPath)) {
    return {
      migrated: configCopied || secretsCopied,
      migratedEntries: 0,
      configCopied,
      secretsCopied,
      skipped: true,
      markerPath,
    };
  }

  const legacyEntries = readdirSync(legacyRoot, { withFileTypes: true })
    .map((entry) => entry.name)
    .filter((name) => !LEGACY_RUNTIME_EXCLUDE_NAMES.has(name));

  let migratedEntries = 0;
  for (const entryName of legacyEntries) {
    const sourcePath = resolve(legacyRoot, entryName);
    const targetPath = resolve(workspaceDirectory, entryName);
    if (copyEntryIfMissing(sourcePath, targetPath)) {
      migratedEntries += 1;
    }
  }

  if (legacyEntries.length > 0) {
    writeMigrationMarker(markerPath);
  }

  return {
    migrated: configCopied || secretsCopied || migratedEntries > 0,
    migratedEntries,
    configCopied,
    secretsCopied,
    skipped: false,
    markerPath,
  };
}
