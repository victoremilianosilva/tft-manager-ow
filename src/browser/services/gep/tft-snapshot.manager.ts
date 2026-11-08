import { randomUUID } from "crypto";
/**
 * Maintains a revisioned GEP baseline internally and publishes only the
 * canonical, game-ready state contract. Raw GEP paths never leave this module.
 */
import { CanonicalTftState, mapGepInfoToCanonicalState } from "./tft-live-state.mapper";
export interface TftGepSnapshot {
  schemaVersion: 2; gameId: number; sessionId: string; revision: number;
  capturedAt: string; complete: boolean; state: CanonicalTftState;
}
type UnknownRecord = Record<string, any>;
const BLOCKED_FEATURES = new Set(["battle", "combat", "battle_stats", "local_player_damage", "damage", "lcu_info", "lcuinfo"]);
const BLOCKED_KEYS = new Set([
  "token","credentials","lcu_info","lcuinfo","puuid","account_id","accountid",
  "summoner_id","summonerid","player_puuid","riot_id","platform_id",
  "battle_stats","local_player_damage","combat","combat_stats","combat_telemetry","damage","damage_stats",
]);
function isRecord(value: unknown): value is UnknownRecord { return value !== null && typeof value === "object" && !Array.isArray(value); }
function parseValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return value;
  try { return JSON.parse(trimmed); } catch { return value; }
}
function cleanStrategicValue(value: unknown): unknown {
  const parsed = parseValue(value);
  if (Array.isArray(parsed)) return parsed.map(cleanStrategicValue);
  if (!isRecord(parsed)) return parsed;
  const result: UnknownRecord = {};
  for (const [key, nested] of Object.entries(parsed)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (BLOCKED_KEYS.has(key.toLowerCase()) || BLOCKED_KEYS.has(normalized) ||
        normalized.includes("puuid") || normalized.includes("credential")) continue;
    result[key] = cleanStrategicValue(nested);
  }
  return result;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (isRecord(value)) return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  return JSON.stringify(value);
}
function deepMerge(target: UnknownRecord, source: UnknownRecord): UnknownRecord {
  const result: UnknownRecord = { ...target };
  for (const [key, raw] of Object.entries(source)) {
    const value = parseValue(raw);
    if (Array.isArray(value)) result[key] = value.map(cleanStrategicValue);
    else if (isRecord(value)) result[key] = deepMerge(isRecord(result[key]) ? result[key] : {}, value);
    else result[key] = value;
  }
  return result;
}
function toFeatureTree(payload: unknown): UnknownRecord {
  if (!isRecord(payload)) return {};
  if (isRecord(payload.info)) return payload.info;
  const feature = typeof payload.feature === "string" ? payload.feature : undefined;
  const category = typeof payload.category === "string" ? payload.category : undefined;
  const key = typeof payload.key === "string" ? payload.key : undefined;
  if (feature && key) {
    const value = Object.prototype.hasOwnProperty.call(payload, "value") ? payload.value : payload.data;
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
  private info: UnknownRecord = {};
  private revision = 0;
  private sessionId = randomUUID();
  private capturedAt = new Date().toISOString();
  private complete = false;
  private reconciling = false;
  private bufferedUpdates: unknown[] = [];
  constructor(private gameId: number) {}
  public beginReconciliation(): void { this.reconciling = true; this.bufferedUpdates = []; }
  public applyInfoUpdate(payload: unknown): TftGepSnapshot | null {
    if (this.reconciling) { this.bufferedUpdates.push(payload); return null; }
    return this.mergePayload(payload) ? this.getSnapshot() : null;
  }
  public finishReconciliation(info: unknown): TftGepSnapshot {
    const pending = this.bufferedUpdates;
    this.bufferedUpdates = []; this.reconciling = false;
    const baseline = strategicTree(info);
    if (canonical(this.info) !== canonical(baseline) || this.revision === 0) {
      this.info = baseline; this.bumpRevision();
    }
    this.complete = true;
    for (const update of pending) this.mergePayload(update);
    return this.getSnapshot();
  }
  public markIncomplete(): TftGepSnapshot { this.complete = false; return this.getSnapshot(); }
  public reset(gameId: number): TftGepSnapshot {
    this.gameId = gameId; this.sessionId = randomUUID(); this.info = {}; this.revision = 0;
    this.capturedAt = new Date().toISOString(); this.complete = false;
    this.reconciling = false; this.bufferedUpdates = [];
    return this.getSnapshot();
  }
  public getSnapshot(): TftGepSnapshot {
    return {
      schemaVersion: 2, gameId: this.gameId, sessionId: this.sessionId, revision: this.revision,
      capturedAt: this.capturedAt, complete: this.complete,
      state: mapGepInfoToCanonicalState(this.info),
    };
  }
  private mergePayload(payload: unknown): boolean {
    const tree = strategicTree(payload);
    if (!Object.keys(tree).length) return false;
    const merged = deepMerge(this.info, tree);
    if (canonical(merged) === canonical(this.info)) return false;
    this.info = merged; this.bumpRevision(); return true;
  }
  private bumpRevision(): void { this.revision += 1; this.capturedAt = new Date().toISOString(); }
}
