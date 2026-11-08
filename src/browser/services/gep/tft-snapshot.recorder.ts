import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { TftGepSnapshot } from './tft-snapshot.manager';

export type TftCaptureRecordKind = 'state_snapshot' | 'state_delta' | 'lifecycle' | 'capture_error';

/** Remove credentials and account identifiers before any serialization. */
export function sanitizeTftPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeTftPayload);
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normalized === 'token' || normalized === 'credentials' ||
        normalized === 'lcuinfo' || normalized.includes('puuid') ||
        normalized === 'accountid' || normalized === 'summonerid' ||
        normalized === 'platformid' || normalized === 'riotid') continue;
    if (normalized === 'augments' || normalized === 'augmentchoices') {
      result[key] = '[redacted: Overwolf TFT GEP display restriction]';
    } else result[key] = sanitizeTftPayload(nested);
  }
  return result;
}

function flatten(value: unknown, prefix = '', output: Record<string, unknown> = {}): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      flatten(nested, prefix ? prefix + '.' + key : key, output);
    }
  } else output[prefix] = value;
  return output;
}
function diffState(previous: unknown, next: unknown): Record<string, unknown> {
  const before = flatten(previous);
  const after = flatten(next);
  const changes: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changes[key] = after[key];
  }
  for (const key of Object.keys(before)) if (!(key in after)) changes[key] = null;
  return changes;
}

/** Writes a full baseline followed only by compact semantic state deltas. */
export class TftSnapshotRecorder {
  private readonly outputDirectory: string;
  private readonly outputFile: string;
  private writeQueue: Promise<void> = Promise.resolve();
  private lastState: unknown = null;
  private stateQueue: Promise<void> = Promise.resolve();
  private readonly sessionId: string;

  constructor() {
    this.outputDirectory = path.join(app.getPath('userData'), 'tft-snapshots');
    this.sessionId = new Date().toISOString().replace(/[:.]/g, '-');
    this.outputFile = path.join(this.outputDirectory, `tft-session-${this.sessionId}.jsonl`);
  }

  public record(snapshot: TftGepSnapshot): Promise<void> {
    // Serialize state comparisons as well as writes so concurrent GEP updates
    // cannot produce two baselines or advance the diff cursor after a failed write.
    this.stateQueue = this.stateQueue.catch(() => undefined).then(async () => {
      const safe = sanitizeTftPayload(snapshot) as TftGepSnapshot;
      const initial = this.lastState === null;
      const changes = initial ? null : diffState(this.lastState, safe.state);
      if (!initial && (!changes || Object.keys(changes).length === 0)) return;

      const entry = initial ? {
        recordType: 'state_snapshot', capturedAt: safe.capturedAt,
        sessionId: this.sessionId, gameId: safe.gameId,
        revision: safe.revision, complete: safe.complete, state: safe.state,
      } : {
        recordType: 'state_delta', capturedAt: safe.capturedAt,
        sessionId: this.sessionId, gameId: safe.gameId,
        revision: safe.revision, parentRevision: safe.revision - 1,
        changes,
      };
      await this.append(entry);
      this.lastState = JSON.parse(JSON.stringify(safe.state));
    });
    return this.stateQueue;
  }

  public recordLifecycle(gameId: number, event: string, payload?: unknown): Promise<void> {
    return this.append({
      recordType: 'lifecycle', capturedAt: new Date().toISOString(),
      sessionId: this.sessionId, gameId,
      payload: sanitizeTftPayload({ event, data: payload ?? null }),
    });
  }

  public recordError(gameId: number, error: unknown, details?: unknown): Promise<void> {
    return this.append({
      recordType: 'capture_error', capturedAt: new Date().toISOString(),
      sessionId: this.sessionId, gameId,
      payload: sanitizeTftPayload({
        message: error instanceof Error ? error.message : String(error),
        details: details ?? null,
      }),
    });
  }

  private append(entry: unknown): Promise<void> {
    const line = JSON.stringify(entry) + '\n';
    this.writeQueue = this.writeQueue.catch(() => undefined).then(async () => {
      await fs.promises.mkdir(this.outputDirectory, { recursive: true });
      await fs.promises.appendFile(this.outputFile, line, { encoding: 'utf8' });
    });
    return this.writeQueue;
  }
  public getFilePath(): string { return this.outputFile; }
}
