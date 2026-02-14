import { createHash } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';

type ParserMode = 'normal' | 'esc' | 'csi' | 'osc' | 'osc-esc';
type ActiveScreen = 'primary' | 'alternate';

interface ScreenCursor {
  row: number;
  col: number;
}

class ScreenBuffer {
  cols: number;
  rows: number;
  private cells: string[][];

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.cells = Array.from({ length: rows }, () => ScreenBuffer.blankLine(cols));
  }

  resize(cols: number, rows: number): void {
    const nextCells = Array.from({ length: rows }, (_, rowIdx) => {
      const line = ScreenBuffer.blankLine(cols);
      if (rowIdx < this.cells.length) {
        const previous = this.cells[rowIdx]!;
        for (let colIdx = 0; colIdx < Math.min(cols, previous.length); colIdx += 1) {
          line[colIdx] = previous[colIdx]!;
        }
      }
      return line;
    });
    this.cols = cols;
    this.rows = rows;
    this.cells = nextCells;
  }

  clear(): void {
    this.cells = Array.from({ length: this.rows }, () => ScreenBuffer.blankLine(this.cols));
  }

  putChar(cursor: ScreenCursor, char: string): void {
    this.cells[cursor.row]![cursor.col] = char;
    cursor.col += 1;
    if (cursor.col >= this.cols) {
      cursor.col = 0;
      cursor.row += 1;
      if (cursor.row >= this.rows) {
        this.scrollUp(1);
        cursor.row = this.rows - 1;
      }
    }
  }

  clearScreen(cursor: ScreenCursor, mode: number): void {
    if (mode === 2) {
      this.clear();
      cursor.row = 0;
      cursor.col = 0;
      return;
    }

    if (mode === 3) {
      this.clear();
      cursor.row = 0;
      cursor.col = 0;
      return;
    }

    if (mode === 1) {
      for (let row = 0; row <= cursor.row; row += 1) {
        const end = row === cursor.row ? cursor.col : this.cols;
        for (let col = 0; col < end; col += 1) {
          this.cells[row]![col] = ' ';
        }
      }
      return;
    }

    for (let row = cursor.row; row < this.rows; row += 1) {
      const start = row === cursor.row ? cursor.col : 0;
      for (let col = start; col < this.cols; col += 1) {
        this.cells[row]![col] = ' ';
      }
    }
  }

  clearLine(cursor: ScreenCursor, mode: number): void {
    if (mode === 2) {
      this.cells[cursor.row] = ScreenBuffer.blankLine(this.cols);
      return;
    }

    if (mode === 1) {
      for (let col = 0; col <= cursor.col; col += 1) {
        this.cells[cursor.row]![col] = ' ';
      }
      return;
    }

    for (let col = cursor.col; col < this.cols; col += 1) {
      this.cells[cursor.row]![col] = ' ';
    }
  }

  scrollUp(lines: number): void {
    for (let idx = 0; idx < lines; idx += 1) {
      this.cells.shift();
      this.cells.push(ScreenBuffer.blankLine(this.cols));
    }
  }

  scrollDown(lines: number): void {
    for (let idx = 0; idx < lines; idx += 1) {
      this.cells.pop();
      this.cells.unshift(ScreenBuffer.blankLine(this.cols));
    }
  }

  lines(): string[] {
    return this.cells.map((line) => ScreenBuffer.trimRight(line.join('')));
  }

  private static blankLine(cols: number): string[] {
    return Array.from({ length: cols }, () => ' ');
  }

  private static trimRight(value: string): string {
    let end = value.length;
    while (end > 0 && value.charCodeAt(end - 1) === 32) {
      end -= 1;
    }
    return value.slice(0, end);
  }
}

export interface TerminalSnapshotFrame {
  rows: number;
  cols: number;
  activeScreen: ActiveScreen;
  cursor: {
    row: number;
    col: number;
    visible: boolean;
  };
  lines: string[];
  frameHash: string;
}

export class TerminalSnapshotOracle {
  private readonly decoder = new StringDecoder('utf8');
  private primary: ScreenBuffer;
  private alternate: ScreenBuffer;
  private activeScreen: ActiveScreen = 'primary';
  private cursor: ScreenCursor = { row: 0, col: 0 };
  private savedCursor: ScreenCursor | null = null;
  private mode: ParserMode = 'normal';
  private csiBuffer = '';
  private cursorVisible = true;

  constructor(cols: number, rows: number) {
    this.primary = new ScreenBuffer(cols, rows);
    this.alternate = new ScreenBuffer(cols, rows);
  }

  ingest(chunk: string | Uint8Array): void {
    const text = typeof chunk === 'string' ? chunk : this.decoder.write(Buffer.from(chunk));
    for (const char of text) {
      this.processChar(char);
    }
  }

  resize(cols: number, rows: number): void {
    if (cols <= 0) {
      return;
    }
    if (rows <= 0) {
      return;
    }
    this.primary.resize(cols, rows);
    this.alternate.resize(cols, rows);
    this.cursor.row = Math.max(0, Math.min(rows - 1, this.cursor.row));
    this.cursor.col = Math.max(0, Math.min(cols - 1, this.cursor.col));
  }

  snapshot(): TerminalSnapshotFrame {
    const screen = this.currentScreen();
    const frameWithoutHash = {
      rows: screen.rows,
      cols: screen.cols,
      activeScreen: this.activeScreen,
      cursor: {
        row: this.cursor.row,
        col: this.cursor.col,
        visible: this.cursorVisible
      },
      lines: screen.lines()
    };
    const frameHash = createHash('sha256').update(JSON.stringify(frameWithoutHash)).digest('hex');
    return {
      ...frameWithoutHash,
      frameHash
    };
  }

  private currentScreen(): ScreenBuffer {
    return this.activeScreen === 'primary' ? this.primary : this.alternate;
  }

  private processChar(char: string): void {
    if (this.mode === 'normal') {
      this.processNormal(char);
      return;
    }
    if (this.mode === 'esc') {
      this.processEsc(char);
      return;
    }
    if (this.mode === 'csi') {
      this.processCsi(char);
      return;
    }
    if (this.mode === 'osc') {
      this.processOsc(char);
      return;
    }
    this.processOscEsc(char);
  }

  private processNormal(char: string): void {
    const code = char.charCodeAt(0);
    if (char === '\u001b') {
      this.mode = 'esc';
      return;
    }
    if (char === '\r') {
      this.cursor.col = 0;
      return;
    }
    if (char === '\n') {
      this.cursor.row += 1;
      if (this.cursor.row >= this.currentScreen().rows) {
        this.currentScreen().scrollUp(1);
        this.cursor.row = this.currentScreen().rows - 1;
      }
      return;
    }
    if (char === '\b') {
      this.cursor.col = Math.max(0, this.cursor.col - 1);
      return;
    }
    if (code < 0x20) {
      return;
    }
    if (code === 0x7f) {
      return;
    }
    this.currentScreen().putChar(this.cursor, char);
  }

  private processEsc(char: string): void {
    if (char === '[') {
      this.mode = 'csi';
      this.csiBuffer = '';
      return;
    }
    if (char === ']') {
      this.mode = 'osc';
      return;
    }
    if (char === '7') {
      this.savedCursor = { row: this.cursor.row, col: this.cursor.col };
      this.mode = 'normal';
      return;
    }
    if (char === '8') {
      if (this.savedCursor !== null) {
        this.cursor = { row: this.savedCursor.row, col: this.savedCursor.col };
      }
      this.mode = 'normal';
      return;
    }
    this.mode = 'normal';
  }

  private processCsi(char: string): void {
    const code = char.charCodeAt(0);
    if (code >= 0x40 && code <= 0x7e) {
      const finalByte = char;
      const rawParams = this.csiBuffer;
      this.mode = 'normal';
      this.csiBuffer = '';
      this.applyCsi(rawParams, finalByte);
      return;
    }
    this.csiBuffer += char;
  }

  private processOsc(char: string): void {
    if (char === '\u0007') {
      this.mode = 'normal';
      return;
    }
    if (char === '\u001b') {
      this.mode = 'osc-esc';
    }
  }

  private processOscEsc(char: string): void {
    if (char === '\\') {
      this.mode = 'normal';
      return;
    }
    this.mode = 'osc';
  }

  private applyCsi(rawParams: string, finalByte: string): void {
    const privateMode = rawParams.startsWith('?');
    const params = (privateMode ? rawParams.slice(1) : rawParams).split(';').map((part) => {
      if (part.length === 0) {
        return NaN;
      }
      return Number(part);
    });
    const first = Number.isFinite(params[0]) ? (params[0] as number) : 1;

    if (privateMode) {
      if (finalByte === 'h') {
        this.applyPrivateMode(params, true);
        return;
      }
      if (finalByte === 'l') {
        this.applyPrivateMode(params, false);
        return;
      }
    }

    if (finalByte === 'A') {
      this.cursor.row = Math.max(0, this.cursor.row - first);
      return;
    }
    if (finalByte === 'B') {
      this.cursor.row = Math.min(this.currentScreen().rows - 1, this.cursor.row + first);
      return;
    }
    if (finalByte === 'C') {
      this.cursor.col = Math.min(this.currentScreen().cols - 1, this.cursor.col + first);
      return;
    }
    if (finalByte === 'D') {
      this.cursor.col = Math.max(0, this.cursor.col - first);
      return;
    }
    if (finalByte === 'G') {
      this.cursor.col = Math.max(0, Math.min(this.currentScreen().cols - 1, first - 1));
      return;
    }
    if (finalByte === 'H') {
      const row = Number.isFinite(params[0]) ? (params[0] as number) : 1;
      const col = Number.isFinite(params[1]) ? (params[1] as number) : 1;
      this.cursor.row = Math.max(0, Math.min(this.currentScreen().rows - 1, row - 1));
      this.cursor.col = Math.max(0, Math.min(this.currentScreen().cols - 1, col - 1));
      return;
    }
    if (finalByte === 'f') {
      const row = Number.isFinite(params[0]) ? (params[0] as number) : 1;
      const col = Number.isFinite(params[1]) ? (params[1] as number) : 1;
      this.cursor.row = Math.max(0, Math.min(this.currentScreen().rows - 1, row - 1));
      this.cursor.col = Math.max(0, Math.min(this.currentScreen().cols - 1, col - 1));
      return;
    }
    if (finalByte === 'J') {
      const mode = Number.isFinite(params[0]) ? (params[0] as number) : 0;
      this.currentScreen().clearScreen(this.cursor, mode);
      return;
    }
    if (finalByte === 'K') {
      const mode = Number.isFinite(params[0]) ? (params[0] as number) : 0;
      this.currentScreen().clearLine(this.cursor, mode);
      return;
    }
    if (finalByte === 'S') {
      this.currentScreen().scrollUp(first);
      return;
    }
    if (finalByte === 'T') {
      this.currentScreen().scrollDown(first);
      return;
    }
    if (finalByte === 's') {
      this.savedCursor = { row: this.cursor.row, col: this.cursor.col };
      return;
    }
    if (finalByte === 'u') {
      if (this.savedCursor !== null) {
        this.cursor = { row: this.savedCursor.row, col: this.savedCursor.col };
      }
    }
  }

  private applyPrivateMode(params: number[], enabled: boolean): void {
    for (const value of params) {
      if (!Number.isFinite(value)) {
        continue;
      }
      if (value === 25) {
        this.cursorVisible = enabled;
        continue;
      }
      if (value === 1047) {
        this.activeScreen = enabled ? 'alternate' : 'primary';
        if (enabled) {
          this.alternate.clear();
          this.cursor = { row: 0, col: 0 };
        }
        continue;
      }
      if (value === 1048) {
        if (enabled) {
          this.savedCursor = { row: this.cursor.row, col: this.cursor.col };
        } else if (this.savedCursor !== null) {
          this.cursor = { row: this.savedCursor.row, col: this.savedCursor.col };
        }
        continue;
      }
      if (value === 1049) {
        if (enabled) {
          this.savedCursor = { row: this.cursor.row, col: this.cursor.col };
          this.activeScreen = 'alternate';
          this.alternate.clear();
          this.cursor = { row: 0, col: 0 };
        } else {
          this.activeScreen = 'primary';
          if (this.savedCursor !== null) {
            this.cursor = { row: this.savedCursor.row, col: this.savedCursor.col };
          }
        }
      }
    }
  }
}

export function renderSnapshotText(frame: TerminalSnapshotFrame): string {
  return frame.lines.join('\n');
}
