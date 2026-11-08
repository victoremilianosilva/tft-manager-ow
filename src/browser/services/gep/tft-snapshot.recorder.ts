import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { TftGepSnapshot } from './tft-snapshot.manager';

export type TftCaptureRecordKind = 'state_snapshot' | 'state_delta' | 'lifecycle' | 'capture_error';

export function sanitizeTftPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeTftPayload);
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normalized === 'token' || normalized === 'credentials' || normalized === 'password' || normalized === 'secret' || normalized === 'authorization' || normalized === 'apikey' || normalized === 'lcuinfo' ||
        normalized.includes('puuid') || normalized === 'accountid' || normalized === 'summonerid' ||
        normalized === 'platformid' || normalized === 'riotid') continue;
    if (normalized === 'augments' || normalized === 'augmentchoices') {
      result[key] = '[redacted: Overwolf TFT GEP display restriction]';
    } else result[key] = sanitizeTftPayload(nested);
  }
  return result;
}

function flatten(value: unknown, prefix = '', output: Record<string, unknown> = {}): Record<string, unknown> {
  if (Array.isArray(value)) {
    value.forEach((nested, index) => flatten(nested, prefix ? prefix + '.' + index : String(index), output));
  } else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      flatten(nested, prefix ? prefix + '.' + key : key, output);
    }
  } else output[prefix] = value;
  return output;
}
function diffState(previous: unknown, next: unknown): Record<string, unknown> {
  const before = flatten(previous), after = flatten(next);
  const changes: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changes[key] = after[key];
  }
  for (const key of Object.keys(before)) if (!(key in after)) changes[key] = null;
  return changes;
}

export class TftSnapshotRecorder {
  private readonly outputDirectory: string;
  private readonly outputFile: string;
  private writeQueue: Promise<void> = Promise.resolve();
  private lastState: unknown = null;
  private lastRevision: number | null = null;
  private lastGameSessionId: string | null = null;
  private lastMatchId: string | null = null;
  private stateQueue: Promise<void> = Promise.resolve();
  private readonly sessionId: string;

  constructor() {
    this.outputDirectory = path.join(app.getPath('userData'), 'tft-snapshots');
    this.sessionId = new Date().toISOString().replace(/[:.]/g, '-');
    this.outputFile = path.join(this.outputDirectory, `tft-session-${this.sessionId}.jsonl`);
  }

  public record(snapshot: TftGepSnapshot): Promise<void> {
    this.stateQueue = this.stateQueue.catch(() => undefined).then(async () => {
      const safe = sanitizeTftPayload(snapshot) as TftGepSnapshot;
      const matchId = safe.state.matchId?.known ? safe.state.matchId.value : null;
      const initial = this.lastState === null || this.lastGameSessionId !== safe.sessionId ||
        (matchId !== null && this.lastMatchId !== matchId);
      const changes = initial ? null : diffState(this.lastState, safe.state);
      if (!initial && (!changes || Object.keys(changes).length === 0)) return;
      const entry = initial ? {
        recordType: 'state_snapshot', capturedAt: safe.capturedAt,
        sessionId: this.sessionId, gameSessionId: safe.sessionId, gameId: safe.gameId,
        revision: safe.revision, complete: safe.complete, state: safe.state,
      } : {
        recordType: 'state_delta', capturedAt: safe.capturedAt,
        sessionId: this.sessionId, gameSessionId: safe.sessionId, gameId: safe.gameId,
        revision: safe.revision, parentRevision: this.lastRevision, changes,
      };
      await this.append(entry);
      this.lastState = JSON.parse(JSON.stringify(safe.state));
      this.lastRevision = safe.revision;
      this.lastGameSessionId = safe.sessionId;
      this.lastMatchId = matchId;
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


/**
 * Appends full, sanitized records to two independent audit streams:
 * raw GEP events and the exact canonical envelopes intended for IA.
 * Neither stream contains authentication material or account identifiers.
 */
export class TftDualAuditRecorder {
  private readonly outputDirectory = path.join(app.getPath('userData'), 'tft-snapshots');
  private readonly rawFile: string;
  private readonly inferenceFile: string;
  private rawQueue: Promise<void> = Promise.resolve();
  private inferenceQueue: Promise<void> = Promise.resolve();
  private readonly sessionId = new Date().toISOString().replace(/[:.]/g, '-');

  constructor() {
    this.rawFile = path.join(this.outputDirectory, `tft-gep-raw-${this.sessionId}.jsonl`);
    this.inferenceFile = path.join(this.outputDirectory, `tft-ia-payloads-${this.sessionId}.jsonl`);
  }

  public recordRawGepEvent(event: string, gameId: number, payload: unknown): Promise<void> {
    const entry = {
      recordType: 'raw_gep_event',
      capturedAt: new Date().toISOString(),
      auditSessionId: this.sessionId,
      gameId,
      event,
      payload: sanitizeTftPayload(payload),
    };
    this.rawQueue = this.rawQueue.catch(() => undefined).then(() => this.append(this.rawFile, entry));
    return this.rawQueue;
  }

  public recordLifecycle(gameId: number, event: string, payload?: unknown): Promise<void> {
    return this.recordRawGepEvent('lifecycle:' + event, gameId, payload ?? null);
  }

  public recordError(gameId: number, error: unknown, details?: unknown): Promise<void> {
    return this.recordRawGepEvent('capture-error', gameId, {
      message: error instanceof Error ? error.message : String(error), details: details ?? null,
    });
  }

  public recordInferencePayload(snapshot: TftGepSnapshot): Promise<void> {
    const entry = {
      recordType: 'canonical_ia_payload',
      capturedAt: new Date().toISOString(),
      auditSessionId: this.sessionId,
      payload: sanitizeTftPayload(snapshot),
    };
    this.inferenceQueue = this.inferenceQueue.catch(() => undefined).then(() => this.append(this.inferenceFile, entry));
    return this.inferenceQueue;
  }

  private async append(file: string, entry: unknown): Promise<void> {
    await fs.promises.mkdir(this.outputDirectory, { recursive: true });
    await fs.promises.appendFile(file, JSON.stringify(entry) + '\\n', { encoding: 'utf8' });
  }

  public getRawFilePath(): string { return this.rawFile; }
  public getInferenceFilePath(): string { return this.inferenceFile; }
}
