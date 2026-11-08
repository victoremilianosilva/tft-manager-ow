/**
 * Strategic TFT state manager. GEP updates are partial; merge them and publish
 * only when the AI-relevant state changes. Combat telemetry/private IDs are dropped.
 */
export interface TftGepSnapshot {
  schemaVersion: 1; gameId: number; revision: number;
  capturedAt: string; complete: boolean; info: Record<string, any>;
}
type UnknownRecord = Record<string, any>;
const BLOCKED_FEATURES = new Set(['battle', 'combat', 'battle_stats']);
const BLOCKED_KEYS = new Set([
  'token','credentials','lcu_info','lcuinfo','puuid','account_id','accountid',
  'summoner_id','summonerid','player_puuid','riot_id','platform_id',
  'battle_stats','local_player_damage','combat','combat_stats',
  'combat_telemetry','damage','damage_stats',
]);
function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function parseValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return value;
  try { return JSON.parse(trimmed); } catch { return value; }
}
function normalizeValue(value: unknown): unknown {
  const parsed = parseValue(value);
  if (Array.isArray(parsed)) return parsed.map(normalizeValue);
  if (isRecord(parsed)) {
    const result: UnknownRecord = {};
    for (const [key, nested] of Object.entries(parsed)) result[key] = normalizeValue(nested);
    return result;
  }
  return parsed;
}
function cleanStrategicValue(value: unknown): unknown {
  const parsed = parseValue(value);
  if (Array.isArray(parsed)) return parsed.map(cleanStrategicValue);
  if (!isRecord(parsed)) return parsed;
  const result: UnknownRecord = {};
  for (const [key, nested] of Object.entries(parsed)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (BLOCKED_KEYS.has(key.toLowerCase()) || BLOCKED_KEYS.has(normalized) ||
        normalized.includes('puuid') || normalized.includes('credential')) continue;
    result[key] = cleanStrategicValue(nested);
  }
  return result;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (isRecord(value)) return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function deepMerge(target: UnknownRecord, source: UnknownRecord): UnknownRecord {
  const result: UnknownRecord = { ...target };
  for (const [key, raw] of Object.entries(source)) {
    const value = parseValue(raw);
    if (Array.isArray(value)) result[key] = value.map(normalizeValue);
    else if (isRecord(value)) result[key] = deepMerge(isRecord(result[key]) ? result[key] : {}, value);
    else result[key] = value;
  }
  return result;
}
function toFeatureTree(payload: unknown): UnknownRecord {
  if (!isRecord(payload)) return {};
  if (isRecord(payload.info)) return payload.info;
  const feature = typeof payload.feature === 'string' ? payload.feature : undefined;
  const category = typeof payload.category === 'string' ? payload.category : undefined;
  const key = typeof payload.key === 'string' ? payload.key : undefined;
  if (feature && key) {
    const value = Object.prototype.hasOwnProperty.call(payload, 'value') ? payload.value : payload.data;
    return category ? { [feature]: { [category]: { [key]: value } } } : { [feature]: { [key]: value } };
  }
  if (isRecord(payload.res)) return toFeatureTree(payload.res);
  return payload;
}
function strategicTree(payload: unknown): UnknownRecord {
  const result: UnknownRecord = {};
  for (const [feature, value] of Object.entries(toFeatureTree(payload))) {
    if (!BLOCKED_FEATURES.has(feature.toLowerCase())) result[feature] = cleanStrategicValue(value);
  }
  return result;
}
export class TftSnapshotManager {
  private snapshot: TftGepSnapshot;
  private reconciling = false;
  private bufferedUpdates: unknown[] = [];
  constructor(gameId: number) {
    this.snapshot = { schemaVersion: 1, gameId, revision: 0,
      capturedAt: new Date().toISOString(), complete: false, info: {} };
  }
  public beginReconciliation(): void { this.reconciling = true; this.bufferedUpdates = []; }
  public applyInfoUpdate(payload: unknown): TftGepSnapshot | null {
    if (this.reconciling) { this.bufferedUpdates.push(payload); return null; }
    return this.mergePayload(payload) ? this.getSnapshot() : null;
  }
  public finishReconciliation(info: unknown): TftGepSnapshot {
    const pending = this.bufferedUpdates;
    this.bufferedUpdates = []; this.reconciling = false;
    const baseline = strategicTree(info);
    if (canonical(this.snapshot.info) !== canonical(baseline) || this.snapshot.revision === 0) {
      this.snapshot.info = baseline; this.bumpRevision();
    }
    this.snapshot.complete = true;
    for (const update of pending) this.mergePayload(update);
    return this.getSnapshot();
  }
  public markIncomplete(): TftGepSnapshot { this.snapshot.complete = false; return this.getSnapshot(); }
  public reset(gameId: number): TftGepSnapshot {
    this.snapshot = { schemaVersion: 1, gameId, revision: 0,
      capturedAt: new Date().toISOString(), complete: false, info: {} };
    this.reconciling = false; this.bufferedUpdates = []; return this.getSnapshot();
  }
  public getSnapshot(): TftGepSnapshot {
    return { ...this.snapshot, info: JSON.parse(JSON.stringify(this.snapshot.info)) };
  }
  private mergePayload(payload: unknown): boolean {
    const tree = strategicTree(payload);
    if (!Object.keys(tree).length) return false;
    const merged = deepMerge(this.snapshot.info, tree);
    if (canonical(merged) === canonical(this.snapshot.info)) return false;
    this.snapshot.info = merged; this.bumpRevision(); return true;
  }
  private bumpRevision(): void {
    this.snapshot.revision += 1; this.snapshot.capturedAt = new Date().toISOString();
  }
}
