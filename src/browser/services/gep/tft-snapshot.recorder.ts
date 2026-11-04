import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { TftGepSnapshot } from './tft-snapshot.manager';

/**
 * Persists one JSON snapshot per line for offline replay and capture audits.
 * Files are kept under the application's userData directory, not in logs.
 */
export class TftSnapshotRecorder {
  private readonly outputDirectory: string;
  private readonly outputFile: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor() {
    this.outputDirectory = path.join(app.getPath('userData'), 'tft-snapshots');
    const sessionId = new Date().toISOString().replace(/[:.]/g, '-');
    this.outputFile = path.join(
      this.outputDirectory,
      `tft-session-${sessionId}.jsonl`,
    );
  }

  public record(snapshot: TftGepSnapshot): Promise<void> {
    const line = `${JSON.stringify(snapshot)}\n`;
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.promises.mkdir(this.outputDirectory, { recursive: true });
      await fs.promises.appendFile(this.outputFile, line, { encoding: 'utf8' });
    });
    return this.writeQueue;
  }

  public getFilePath(): string {
    return this.outputFile;
  }
}
