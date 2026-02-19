import { resolve } from 'node:path';
import { resolveHarnessWorkspaceDirectory } from '../../config/harness-paths.ts';

const STATUS_TIMELINE_STATE_FILE_NAME = 'active-status-timeline.json';
export const STATUS_TIMELINE_STATE_VERSION = 1;
export const STATUS_TIMELINE_MODE = 'live-mux-status-timeline';
export const DEFAULT_STATUS_TIMELINE_ROOT_PATH = 'status-timelines';
export const STATUS_TIMELINE_FILE_NAME = 'status-timeline.log';

export interface ActiveStatusTimelineState {
  version: typeof STATUS_TIMELINE_STATE_VERSION;
  mode: typeof STATUS_TIMELINE_MODE;
  outputPath: string;
  sessionName: string | null;
  startedAt: string;
}

export function resolveStatusTimelineStatePath(
  invocationDirectory: string,
  sessionName: string | null,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const workspaceDirectory = resolveHarnessWorkspaceDirectory(invocationDirectory, env);
  if (sessionName === null) {
    return resolve(workspaceDirectory, STATUS_TIMELINE_STATE_FILE_NAME);
  }
  return resolve(workspaceDirectory, 'sessions', sessionName, STATUS_TIMELINE_STATE_FILE_NAME);
}

export function resolveDefaultStatusTimelineOutputPath(
  invocationDirectory: string,
  sessionName: string | null,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const workspaceDirectory = resolveHarnessWorkspaceDirectory(invocationDirectory, env);
  if (sessionName === null) {
    return resolve(workspaceDirectory, 'status-timelines', STATUS_TIMELINE_FILE_NAME);
  }
  return resolve(workspaceDirectory, 'status-timelines', sessionName, STATUS_TIMELINE_FILE_NAME);
}

export function parseActiveStatusTimelineState(raw: unknown): ActiveStatusTimelineState | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  if (candidate['version'] !== STATUS_TIMELINE_STATE_VERSION) {
    return null;
  }
  if (candidate['mode'] !== STATUS_TIMELINE_MODE) {
    return null;
  }
  const outputPath = candidate['outputPath'];
  const sessionName = candidate['sessionName'];
  const startedAt = candidate['startedAt'];
  if (typeof outputPath !== 'string' || outputPath.length === 0) {
    return null;
  }
  if (sessionName !== null && typeof sessionName !== 'string') {
    return null;
  }
  if (typeof startedAt !== 'string' || startedAt.length === 0) {
    return null;
  }
  return {
    version: STATUS_TIMELINE_STATE_VERSION,
    mode: STATUS_TIMELINE_MODE,
    outputPath,
    sessionName,
    startedAt,
  };
}
