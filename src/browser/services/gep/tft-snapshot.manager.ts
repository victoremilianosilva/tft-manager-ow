/**
 * Maintains a complete, revisioned view of GEP info updates.
 *
 * GEP info updates are deltas. They must never be forwarded as if they were
 * complete game state. While getInfo() is in flight, deltas are buffered and
 * replayed after the baseline has been applied so newer values win.
 */

export interface TftGepSnapshot {
  schemaVersion: 1;
  gameId: number;
  revision: number;
  capturedAt: string;
  complete: boolean;
  info: Record<string, any>;
}

type UnknownRecord = Record<string, any>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function normalizeValue(value: unknown): unknown {
  const parsed = parseValue(value);
  if (Array.isArray(parsed)) return parsed.map(normalizeValue);
  if (isRecord(parsed)) {
    const normalized: UnknownRecord = {};
    for (const [key, nestedValue] of Object.entries(parsed)) {
      normalized[key] = normalizeValue(nestedValue);
    }
    return normalized;
  }
  return parsed;
}

function deepMerge(target: UnknownRecord, source: UnknownRecord): UnknownRecord {
  const result: UnknownRecord = { ...target };
  for (const [key, rawValue] of Object.entries(source)) {
    const value = parseValue(rawValue);
    if (isRecord(value)) {
      result[key] = deepMerge(
        isRecord(result[key]) ? result[key] : {},
        value,
      );
    } else if (Array.isArray(value)) {
      result[key] = value.map(normalizeValue);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/** Convert the documented GEP InfoUpdate variants into a feature tree. */
function toFeatureTree(payload: unknown): UnknownRecord {
  if (!isRecord(payload)) return {};

  // Current GEP payloads commonly use { info: { feature: { key: value } } }.
  if (isRecord(payload.info)) return payload.info;

  // Also tolerate the flat form documented by Overwolf:
  // { feature, category, key, value }.
  const feature = typeof payload.feature === 'string' ? payload.feature : undefined;
  const category = typeof payload.category === 'string' ? payload.category : undefined;
  const key = typeof payload.key === 'string' ? payload.key : undefined;
  if (feature && key) {
    const value = Object.prototype.hasOwnProperty.call(payload, 'value')
      ? payload.value
      : payload.data;
    return category
      ? { [feature]: { [category]: { [key]: value } } }
      : { [feature]: { [key]: value } };
  }

  // getInfo() may wrap the complete feature tree in a result object.
  if (isRecord(payload.res)) return toFeatureTree(payload.res);
  return payload;
}

export class TftSnapshotManager {
  private snapshot: TftGepSnapshot;
  private reconciling = false;
  private bufferedUpdates: unknown[] = [];

  constructor(gameId: number) {
    this.snapshot = {
      schemaVersion: 1,
      gameId,
      revision: 0,
      capturedAt: new Date().toISOString(),
      complete: false,
      info: {},
    };
  }

  public beginReconciliation(): void {
    this.reconciling = true;
    this.bufferedUpdates = [];
  }

  public applyInfoUpdate(payload: unknown): TftGepSnapshot | null {
    if (this.reconciling) {
      this.bufferedUpdates.push(payload);
      return null;
    }
    this.mergePayload(payload, false);
    return this.getSnapshot();
  }

  public finishReconciliation(info: unknown): TftGepSnapshot {
    const pending = this.bufferedUpdates;
    this.bufferedUpdates = [];
    this.reconciling = false;

    // getInfo() is the authoritative baseline. Replace stale cached fields,
    // then replay deltas that arrived while the baseline was being fetched.
    this.snapshot.info = {};
    this.mergePayload(info, true);
    for (const update of pending) this.mergePayload(update, false);
    this.snapshot.complete = true;
    return this.getSnapshot();
  }

  public markIncomplete(): TftGepSnapshot {
    this.snapshot.complete = false;
    this.snapshot.capturedAt = new Date().toISOString();
    return this.getSnapshot();
  }

  public reset(gameId: number): TftGepSnapshot {
    this.snapshot = {
      schemaVersion: 1,
      gameId,
      revision: 0,
      capturedAt: new Date().toISOString(),
      complete: false,
      info: {},
    };
    this.reconciling = false;
    this.bufferedUpdates = [];
    return this.getSnapshot();
  }

  public getSnapshot(): TftGepSnapshot {
    return {
      ...this.snapshot,
      info: JSON.parse(JSON.stringify(this.snapshot.info)),
    };
  }

  private mergePayload(payload: unknown, isBaseline: boolean): void {
    const tree = toFeatureTree(payload);
    if (Object.keys(tree).length === 0) return;

    this.snapshot.info = deepMerge(this.snapshot.info, tree);
    this.snapshot.revision += 1;
    this.snapshot.capturedAt = new Date().toISOString();
    if (isBaseline) this.snapshot.complete = true;
  }
}
