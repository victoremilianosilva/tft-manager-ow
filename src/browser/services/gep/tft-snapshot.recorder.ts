import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { TftGepSnapshot } from './tft-snapshot.manager';

export type TftCaptureRecordKind =
  | 'snapshot'
  | 'info_update'
  | 'game_event'
  | 'lifecycle'
  | 'capture_error';

export interface TftCaptureRecord {
  kind: TftCaptureRecordKind;
  gameId: number;
  payload: unknown;
  capturedAt?: string;
  matchId?: string | null;
}

export function sanitizeTftPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeTftPayload);
  if (!value || typeof value !== 'object') return value;

  const sanitized: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (key.toLowerCase() === 'augments' || key.toLowerCase() === 'augment_choices') {
      sanitized[key] = '[redacted: Overwolf TFT GEP display restriction]';
    } else {
      sanitized[key] = sanitizeTftPayload(nested);
    }
  }
  return sanitized;
}

function findMatchId(value: unknown, depth = 0): string | null {
  if (!value || typeof value !== 'object' || depth > 5) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findMatchId(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of ['match_id', 'matchId', 'game_id', 'gameId']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return String(candidate);
  }
  for (const nested of Object.values(record)) {
    const found = findMatchId(nested, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * Append-only JSONL recorder. Every GEP info delta and game event is stored
 * independently, alongside reconciled snapshots. A rejected write never
 * poisons the queue: later records still get an attempt.
 */
export class TftSnapshotRecorder {
  private readonly outputDirectory: string;
  private readonly outputFile: string;
  private writeQueue: Promise<void> = Promise.resolve();
  private lastMatchId: string | null = null;

  constructor() {
    this.outputDirectory = path.join(app.getPath('userData'), 'tft-snapshots');
    const sessionId = new Date().toISOString().replace(/[:.]/g, '-');
    this.outputFile = path.join(
      this.outputDirectory,
      `tft-session-${sessionId}.jsonl`,
    );
  }

  public record(snapshot: TftGepSnapshot): Promise<void> {
    return this.recordEntry({
      kind: 'snapshot',
      gameId: snapshot.gameId,
      payload: snapshot,
      capturedAt: snapshot.capturedAt,
    });
  }

  public recordGepInfo(gameId: number, payload: unknown): Promise<void> {
    return this.recordEntry({ kind: 'info_update', gameId, payload });
  }

  public recordGepEvent(gameId: number, payload: unknown): Promise<void> {
    return this.recordEntry({ kind: 'game_event', gameId, payload });
  }

  public recordLifecycle(gameId: number, event: string, payload?: unknown): Promise<void> {
    return this.recordEntry({
      kind: 'lifecycle',
      gameId,
      payload: { event, data: payload ?? null },
    });
  }

  public recordError(gameId: number, error: unknown): Promise<void> {
    return this.recordEntry({
      kind: 'capture_error',
      gameId,
      payload: { message: error instanceof Error ? error.message : String(error) },
    });
  }

  public recordEntry(record: TftCaptureRecord): Promise<void> {
    const safePayload = sanitizeTftPayload(record.payload);
    const matchId = record.matchId ?? findMatchId(safePayload) ?? this.lastMatchId;
    if (matchId) this.lastMatchId = matchId;
    const line = `${JSON.stringify({
      schemaVersion: 2,
      recordType: record.kind,
      capturedAt: record.capturedAt ?? new Date().toISOString(),
      gameId: record.gameId,
      matchId,
      payload: safePayload,
    })}\n`;

    // Recover the chain after a failed append so a transient filesystem error
    // does not prevent all subsequent events from being persisted.
    this.writeQueue = this.writeQueue.catch(() => undefined).then(async () => {
      await fs.promises.mkdir(this.outputDirectory, { recursive: true });
      await fs.promises.appendFile(this.outputFile, line, { encoding: 'utf8' });
    });
    return this.writeQueue;
  }

  public getFilePath(): string {
    return this.outputFile;
  }
}
