import type { ConversationRailSessionSummary } from './conversation-rail.ts';
import {
  createUiSurface,
  DEFAULT_UI_STYLE,
  drawUiText,
  fillUiRow,
  renderUiSurfaceAnsiRows
} from '../ui/surface.ts';

interface WorkspaceRailDirectorySummary {
  readonly key: string;
  readonly workspaceId: string;
  readonly worktreeId: string;
  readonly active: boolean;
}

interface WorkspaceRailProcessSummary {
  readonly key: string;
  readonly label: string;
  readonly cpuPercent: number | null;
  readonly memoryMb: number | null;
  readonly status: 'running' | 'exited';
}

interface WorkspaceRailGitSummary {
  readonly branch: string;
  readonly changedFiles: number;
  readonly additions: number;
  readonly deletions: number;
}

interface WorkspaceRailModel {
  readonly directories: readonly WorkspaceRailDirectorySummary[];
  readonly conversations: readonly ConversationRailSessionSummary[];
  readonly activeConversationId: string | null;
  readonly processes: readonly WorkspaceRailProcessSummary[];
  readonly git: WorkspaceRailGitSummary;
}

interface RailRow {
  readonly kind: 'header' | 'item' | 'muted' | 'empty';
  readonly text: string;
  readonly active: boolean;
}

const HEADER_STYLE = {
  fg: { kind: 'indexed', index: 252 },
  bg: { kind: 'indexed', index: 236 },
  bold: true
} as const;
const ACTIVE_ROW_STYLE = {
  fg: { kind: 'indexed', index: 255 },
  bg: { kind: 'indexed', index: 238 },
  bold: false
} as const;
const NORMAL_ROW_STYLE = DEFAULT_UI_STYLE;
const MUTED_ROW_STYLE = {
  fg: { kind: 'indexed', index: 245 },
  bg: { kind: 'default' },
  bold: false
} as const;

function compactSessionId(sessionId: string): string {
  if (sessionId.startsWith('conversation-')) {
    const suffix = sessionId.slice('conversation-'.length);
    return suffix.length > 8 ? suffix.slice(0, 8) : suffix;
  }
  return sessionId.length > 16 ? `${sessionId.slice(0, 16)}...` : sessionId;
}

function conversationBadge(status: ConversationRailSessionSummary['status']): string {
  if (status === 'needs-input') {
    return 'NEED';
  }
  if (status === 'running') {
    return 'RUN ';
  }
  if (status === 'completed') {
    return 'DONE';
  }
  return 'EXIT';
}

function processBadge(status: WorkspaceRailProcessSummary['status']): string {
  return status === 'running' ? 'RUN' : 'EXIT';
}

function formatCpu(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return '--.-%';
  }
  return `${value.toFixed(1).padStart(4, ' ')}%`;
}

function formatMemMb(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return '---MB';
  }
  const rounded = Math.round(value);
  return `${String(rounded).padStart(3, ' ')}MB`;
}

function buildRows(model: WorkspaceRailModel, maxRows: number): readonly RailRow[] {
  const rows: RailRow[] = [];
  const pushHeader = (text: string): void => {
    rows.push({
      kind: 'header',
      text,
      active: false
    });
  };
  const pushItem = (text: string, active = false): void => {
    rows.push({
      kind: 'item',
      text,
      active
    });
  };
  const pushMuted = (text: string): void => {
    rows.push({
      kind: 'muted',
      text,
      active: false
    });
  };

  pushHeader(' DIR');
  if (model.directories.length === 0) {
    pushMuted('  (none)');
  } else {
    for (const directory of model.directories) {
      const prefix = directory.active ? '>' : ' ';
      pushItem(`${prefix} ${directory.workspaceId}/${directory.worktreeId}`, directory.active);
    }
  }

  pushHeader(' CONV');
  if (model.conversations.length === 0) {
    pushMuted('  (none)');
  } else {
    for (const session of model.conversations) {
      const active = session.sessionId === model.activeConversationId;
      const prefix = active ? '>' : ' ';
      const reason =
        session.attentionReason !== null && session.attentionReason.length > 0
          ? ` ${session.attentionReason}`
          : '';
      pushItem(
        `${prefix} ${conversationBadge(session.status)} ${compactSessionId(session.sessionId)}${reason}`,
        active
      );
    }
  }

  pushHeader(' PROC');
  if (model.processes.length === 0) {
    pushMuted('  (none)');
  } else {
    for (const process of model.processes) {
      pushItem(
        `  ${processBadge(process.status)} ${process.label} ${formatCpu(process.cpuPercent)} ${formatMemMb(process.memoryMb)}`
      );
    }
  }

  pushHeader(' GIT');
  pushItem(`  ${model.git.branch}`);
  pushItem(`  +${model.git.additions} -${model.git.deletions} | ${model.git.changedFiles} files`);

  if (rows.length > maxRows) {
    return rows.slice(0, maxRows);
  }
  while (rows.length < maxRows) {
    rows.push({
      kind: 'empty',
      text: '',
      active: false
    });
  }
  return rows;
}

export function renderWorkspaceRailAnsiRows(
  model: WorkspaceRailModel,
  width: number,
  maxRows: number
): readonly string[] {
  const safeWidth = Math.max(1, width);
  const safeRows = Math.max(1, maxRows);
  const rows = buildRows(model, safeRows);
  const surface = createUiSurface(safeWidth, safeRows, DEFAULT_UI_STYLE);
  for (let rowIndex = 0; rowIndex < safeRows; rowIndex += 1) {
    const row = rows[rowIndex]!;

    if (row.kind === 'header') {
      fillUiRow(surface, rowIndex, HEADER_STYLE);
      drawUiText(surface, 0, rowIndex, row.text, HEADER_STYLE);
      continue;
    }

    if (row.kind === 'item') {
      const style = row.active ? ACTIVE_ROW_STYLE : NORMAL_ROW_STYLE;
      fillUiRow(surface, rowIndex, style);
      drawUiText(surface, 0, rowIndex, row.text, style);
      continue;
    }

    if (row.kind === 'muted') {
      fillUiRow(surface, rowIndex, NORMAL_ROW_STYLE);
      drawUiText(surface, 0, rowIndex, row.text, MUTED_ROW_STYLE);
      continue;
    }

    fillUiRow(surface, rowIndex, NORMAL_ROW_STYLE);
  }

  return renderUiSurfaceAnsiRows(surface);
}
