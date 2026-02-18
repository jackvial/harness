interface RecordingWriter {
  close(): Promise<void>;
}

interface RenderTerminalRecordingToGifInput {
  readonly recordingPath: string;
  readonly outputPath: string;
}

interface RecordingServiceOptions {
  readonly recordingWriter: RecordingWriter | null;
  readonly recordingPath: string | null;
  readonly recordingGifOutputPath: string | null;
  readonly renderTerminalRecordingToGif: (
    input: RenderTerminalRecordingToGifInput,
  ) => Promise<unknown>;
  readonly writeStderr: (text: string) => void;
}

export class RecordingService {
  constructor(private readonly options: RecordingServiceOptions) {}

  async closeWriter(): Promise<unknown | null> {
    if (this.options.recordingWriter === null) {
      return null;
    }
    try {
      await this.options.recordingWriter.close();
      return null;
    } catch (error: unknown) {
      return error;
    }
  }

  async finalizeAfterShutdown(recordingCloseError: unknown | null): Promise<void> {
    if (
      this.options.recordingGifOutputPath !== null &&
      this.options.recordingPath !== null &&
      recordingCloseError === null
    ) {
      try {
        await this.options.renderTerminalRecordingToGif({
          recordingPath: this.options.recordingPath,
          outputPath: this.options.recordingGifOutputPath,
        });
        this.options.writeStderr(
          `[mux-recording] jsonl=${this.options.recordingPath} gif=${this.options.recordingGifOutputPath}\n`,
        );
      } catch (error: unknown) {
        this.options.writeStderr(
          `[mux-recording] gif-export-failed ${
            error instanceof Error ? error.message : String(error)
          }\n`,
        );
      }
      return;
    }

    if (recordingCloseError !== null) {
      this.options.writeStderr(
        `[mux-recording] close-failed ${this.formatCloseError(recordingCloseError)}\n`,
      );
    }
  }

  private formatCloseError(recordingCloseError: unknown): string {
    if (recordingCloseError instanceof Error) {
      return recordingCloseError.message;
    }
    if (typeof recordingCloseError === 'string') {
      return recordingCloseError;
    }
    return 'unknown error';
  }
}
