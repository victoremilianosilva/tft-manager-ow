import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { createHash, randomUUID } from 'crypto';
import { TftGepSnapshot } from './tft-snapshot.manager';

export type TftCaptureRecordKind = 'state_snapshot' | 'state_delta' | 'lifecycle' | 'capture_error';

export function sanitizeTftPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeTftPayload);
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normalized.includes('token') || normalized.includes('credential') || normalized.includes('password') ||
        normalized.includes('secret') || normalized.includes('authorization') || normalized === 'auth' ||
        normalized.includes('apikey') || normalized.includes('cookie') || normalized === 'lcuinfo' ||
        normalized.includes('puuid') || normalized.includes('accountid') || normalized.includes('summonerid') ||
        normalized.includes('platformid') || normalized === 'riotid' ||
        normalized === 'summoner' || normalized === 'summonername' ||
        normalized === 'playername' || normalized === 'playerpuuid' ||
        normalized === 'battle' || normalized === 'battlestats' ||
        normalized === 'combat' || normalized === 'combatstats' ||
        normalized === 'combattelemetry' || normalized === 'localplayerdamage' ||
        normalized === 'damage' || normalized === 'damagestats') continue;
    if (normalized === 'augments' || normalized === 'augmentchoices') {
      result[key] = '[redacted: Overwolf TFT GEP display restriction]';
    } else if (normalized === 'playerstatus' && nested && typeof nested === 'object' && !Array.isArray(nested)) {
      // Roster keys are summoner display names. Preserve only the provider's
      // numeric seat index so the raw capture remains pseudonymous.
      const players: Record<string, unknown> = {};
      for (const player of Object.values(nested as Record<string, unknown>)) {
        if (!player || typeof player !== 'object' || Array.isArray(player)) continue;
        const index = (player as Record<string, unknown>).index;
        if (typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < 8) {
          players[`player_${index}`] = sanitizeTftPayload(player);
        }
      }
      result[key] = players;
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
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return "{" + Object.keys(record).sort().map(key =>
      JSON.stringify(key) + ":" + stableJson(record[key]),
    ).join(",") + "}";
  }
  const encoded = JSON.stringify(value);
  return encoded === undefined ? "null" : encoded;
}

/**
 * Persists the legacy audit streams and a single hash-chained observational
 * capture. The capture contains only sanitized GEP facts; it is not a
 * deterministic replay and does not claim access to blocked combat telemetry.
 */
export class TftDualAuditRecorder {
  private readonly outputDirectory = path.join(app.getPath('userData'), 'tft-snapshots');
  private readonly rawFile: string;
  private readonly inferenceFile: string;
  private readonly replayFile: string;
  private rawQueue: Promise<void> = Promise.resolve();
  private inferenceQueue: Promise<void> = Promise.resolve();
  private replayQueue: Promise<void> = Promise.resolve();
  private readonly sessionId = randomUUID();
  private replaySequence = 0;
  private previousReplayHash = '';
  private lastGameSessionId: string | null = null;
  private lastMatchId: string | null = null;
  private activeGameSessions = 0;
  private hasGameSession = false;
  private captureErrors = false;
  private closed = false;

  constructor(private readonly gameId: number) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.rawFile = path.join(this.outputDirectory, `tft-gep-raw-${stamp}.jsonl`);
    this.inferenceFile = path.join(this.outputDirectory, `tft-ia-payloads-${stamp}.jsonl`);
    this.replayFile = path.join(this.outputDirectory, `tft-gep-replay-${stamp}.jsonl`);
    this.replayQueue = this.appendReplay('manifest', {
      replay_format: 'TFT_GEP_OBSERVATION_CAPTURE_V1',
      schema_version: 1,
      capture_session_id: this.sessionId,
      source: 'overwolf_gep',
      game_id: this.gameId,
      created_at: new Date().toISOString(),
      replay_mode: 'observational_only',
      deterministic_reexecution: false,
      combat_telemetry_enabled: false,
      privacy_profile: 'tft-gep-sanitized-v1',
    });
  }

  public recordRawGepEvent(event: string, gameId: number, payload: unknown): Promise<void> {
    const safePayload = sanitizeTftPayload(payload);
    const capturedAt = new Date().toISOString();
    const context = {
      capture_session_id: this.sessionId,
      game_session_id: this.lastGameSessionId,
      match_id: this.lastMatchId,
      game_id: gameId,
      event,
      captured_at: capturedAt,
      payload: safePayload,
    };
    this.rawQueue = this.rawQueue.catch(() => undefined).then(() =>
      this.append(this.rawFile, {
        recordType: 'raw_gep_event', capturedAt, auditSessionId: this.sessionId,
        gameId, event, payload: safePayload,
      }),
    );
    const replayWrite = this.appendReplay('raw_gep_event', context);
    return Promise.all([this.rawQueue, replayWrite]).then(() => undefined);
  }

  public recordLifecycle(gameId: number, event: string, payload?: unknown): Promise<void> {
    if (event === 'game-detected') {
      this.hasGameSession = true;
      this.activeGameSessions += 1;
    } else if (event === 'game-exit') {
      this.activeGameSessions = Math.max(0, this.activeGameSessions - 1);
    }
    return this.recordRawGepEvent('lifecycle:' + event, gameId, payload ?? null);
  }

  public recordError(gameId: number, error: unknown, details?: unknown): Promise<void> {
    this.captureErrors = true;
    return this.recordRawGepEvent('capture-error', gameId, {
      message: error instanceof Error ? error.message : String(error), details: details ?? null,
    });
  }

  public recordInferencePayload(snapshot: TftGepSnapshot): Promise<void> {
    const safe = sanitizeTftPayload(snapshot) as TftGepSnapshot;
    this.lastGameSessionId = safe.sessionId;
    this.lastMatchId = safe.state.matchId?.known && safe.state.matchId.value !== null
      ? String(safe.state.matchId.value) : null;
    const capturedAt = new Date().toISOString();
    const entry = {
      recordType: 'canonical_ia_payload',
      capturedAt,
      auditSessionId: this.sessionId,
      payload: safe,
    };
    this.inferenceQueue = this.inferenceQueue.catch(() => undefined).then(() =>
      this.append(this.inferenceFile, entry),
    );
    const replayWrite = this.appendReplay('canonical_state_snapshot', {
      capture_session_id: this.sessionId,
      game_session_id: this.lastGameSessionId,
      match_id: this.lastMatchId,
      game_id: safe.gameId,
      captured_at: capturedAt,
      revision: safe.revision,
      complete: safe.complete,
      state: safe.state,
    });
    return Promise.all([this.inferenceQueue, replayWrite]).then(() => undefined);
  }

  private appendReplay(recordType: string, payload: unknown): Promise<void> {
    this.replayQueue = this.replayQueue.then(async () => {
      if (this.closed) throw new Error('TFT GEP replay capture is closed');
      const body = {
        sequence: this.replaySequence,
        record_type: recordType,
        previous_record_sha256: this.previousReplayHash || null,
        payload: sanitizeTftPayload(payload),
      };
      const bodyJson = stableJson(body);
      const recordHash = createHash('sha256')
        .update(this.previousReplayHash + bodyJson, 'utf8')
        .digest('hex');
      const line = bodyJson.slice(0, -1) +
        ',"record_sha256":' + JSON.stringify(recordHash) + '}';
      await fs.promises.mkdir(this.outputDirectory, { recursive: true });
      await fs.promises.appendFile(this.replayFile, line + '\n', { encoding: 'utf8' });
      this.replaySequence += 1;
      this.previousReplayHash = recordHash;
    });
    return this.replayQueue;
  }

  private async append(file: string, entry: unknown): Promise<void> {
    await fs.promises.mkdir(this.outputDirectory, { recursive: true });
    await fs.promises.appendFile(file, JSON.stringify(entry) + '\n', { encoding: 'utf8' });
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    await Promise.all([this.rawQueue, this.inferenceQueue, this.replayQueue]);
    const complete = this.hasGameSession &&
      this.activeGameSessions === 0 && !this.captureErrors;
    await this.appendReplay('footer', {
      status: complete ? 'completed' : 'incomplete',
      records_before_footer: this.replaySequence,
      final_record_sha256: this.previousReplayHash,
      complete,
    });
    await this.replayQueue;
    this.closed = true;
  }

  public getRawFilePath(): string { return this.rawFile; }
  public getInferenceFilePath(): string { return this.inferenceFile; }
  public getReplayFilePath(): string { return this.replayFile; }
}
