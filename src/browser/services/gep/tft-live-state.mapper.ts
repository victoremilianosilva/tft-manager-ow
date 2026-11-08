/** Canonical TFT state projection. GEP path knowledge lives only in this module. */
type RecordValue = Record<string, any>;
export interface KnownValue<T> { known: boolean; value: T | null; }
export interface CanonicalUnit { apiName: string; star: KnownValue<number>; items: string[]; }
export interface CanonicalSlot { known: boolean; unit: CanonicalUnit | null; }
export interface CanonicalPlayer {
  index: number; localPlayer: boolean;
  hp: KnownValue<number>; gold: KnownValue<number>; level: KnownValue<number>;
  xp: KnownValue<number>; alive: KnownValue<boolean>;
  board: { known: boolean; slots: CanonicalSlot[] };
  bench: { known: boolean; slots: CanonicalSlot[] };
  shop: { known: boolean; slots: KnownValue<string>[] };
  itemComponents: KnownValue<Array<{ apiName: string; count: number }>>;
}
export interface CanonicalTftState {
  contract: "tft.live-state"; contractVersion: 1; matchId: KnownValue<string>;
  stage: KnownValue<number>; round: KnownValue<number>; phase: KnownValue<string>;
  localPlayerIndex: KnownValue<number>; players: Array<CanonicalPlayer | null>;
  carousel: KnownValue<Array<{ items: string[] }>>;
}
const isRecord = (v: unknown): v is RecordValue => !!v && typeof v === "object" && !Array.isArray(v);
const get = (root: unknown, ...path: string[]): any => path.reduce((v, k) => isRecord(v) ? v[k] : undefined, root as any);
const known = <T>(v: T | null | undefined): KnownValue<T> => ({ known: v !== undefined && v !== null, value: v === undefined || v === null ? null : v });
const numberValue = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const textValue = (v: unknown): string | null => typeof v === "string" && v.trim() ? v.trim() : null;
const slotNumber = (key: string, prefix: string, max: number): number | null => {
  const match = new RegExp("^" + prefix + "_([0-9]+)$").exec(key);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isInteger(n) && n >= 1 && n <= max ? n - 1 : null;
};
function unitFrom(value: unknown): CanonicalUnit | null {
  if (!isRecord(value)) return null;
  const apiName = textValue(value.name);
  if (!apiName) return null;
  const star = numberValue(value.level);
  const items = [value.item_1, value.item_2, value.item_3].map(textValue).filter((x): x is string => !!x);
  return { apiName, star: known(star !== null && star >= 1 && star <= 3 ? star : null), items };
}
function mapSlots(source: unknown, prefix: string, size: number): { known: boolean; slots: CanonicalSlot[] } {
  if (!isRecord(source)) return { known: false, slots: [] };
  const slots: CanonicalSlot[] = Array.from({ length: size }, () => ({ known: true, unit: null }));
  for (const [key, value] of Object.entries(source)) {
    const index = slotNumber(key, prefix, size);
    if (index !== null) slots[index] = { known: true, unit: unitFrom(value) };
  }
  return { known: true, slots };
}
function mapShop(source: unknown): { known: boolean; slots: KnownValue<string>[] } {
  if (!isRecord(source)) return { known: false, slots: [] };
  const slots: KnownValue<string>[] = Array.from({ length: 5 }, () => ({ known: true, value: null }));
  for (const [key, value] of Object.entries(source)) {
    const index = slotNumber(key, "slot", 5);
    if (index !== null) slots[index] = { known: true, value: isRecord(value) ? textValue(value.name) : null };
  }
  return { known: true, slots };
}
function mapComponents(source: unknown, localSummoner: string | null, localRosterName: string | null): KnownValue<Array<{ apiName: string; count: number }>> {
  if (!Array.isArray(source)) return known(null);
  // GEP reports an item_bench entry per player. Never merge all players' components.
  const owner = source.find(entry => isRecord(entry) && typeof entry.summoner === "string" &&
    (entry.summoner === localSummoner || entry.summoner === localRosterName));
  if (!isRecord(owner) || !Array.isArray(owner.bench_items)) return known(null);
  const counts = new Map<string, number>();
  for (const item of owner.bench_items) {
    if (!isRecord(item)) continue;
    const name = textValue(item.name), count = numberValue(item.count);
    if (name && count !== null && count > 0) counts.set(name, (counts.get(name) ?? 0) + count);
  }
  return known(Array.from(counts, ([apiName, count]) => ({ apiName, count })).sort((a,b) => a.apiName.localeCompare(b.apiName)));
}
function mapCarousel(source: unknown): KnownValue<Array<{ items: string[] }>> {
  if (!isRecord(source)) return known(null);
  const result: Array<{ items: string[] }> = [];
  for (const [key, value] of Object.entries(source)) {
    if (!/^slot_[1-9]$/.test(key) || !isRecord(value)) continue;
    const items = [value.item_1, value.item_2].map(textValue).filter((x): x is string => !!x);
    result.push({ items });
  }
  return known(result);
}
export function mapGepInfoToCanonicalState(info: unknown): CanonicalTftState {
  const me = get(info, "me", "me");
  const roster = get(info, "roster", "roster", "player_status");
  const board = get(info, "board", "board", "board_pieces");
  const bench = get(info, "bench", "bench", "bench_pieces");
  const shop = get(info, "store", "store", "shop_pieces");
  const itemBench = get(info, "bench", "bench", "item_bench");
  const localSummoner = textValue(me?.summoner_name);
  const rosterEntries = isRecord(roster) ? Object.entries(roster) : [];
  const localRoster = rosterEntries.find(([, value]) => isRecord(value) && value.localplayer === true);
  const localRosterName = localRoster?.[0] ?? null;
  const localIndex = localRoster ? numberValue(get(localRoster[1], "index")) : null;
  const rawMatchId = get(info, "match_info", "match_info", "match_id");
  const matchId = textValue(rawMatchId) ?? (numberValue(rawMatchId) === null ? null : String(numberValue(rawMatchId)));
  const roundText = textValue(get(info, "match_info", "match_info", "round_type", "stage"));
  const roundMatch = roundText ? /^(\d+)-(\d+)$/.exec(roundText) : null;
  const players: Array<CanonicalPlayer | null> = Array.from({ length: 8 }, (_, index) => {
    const entry = rosterEntries.find(([, value]) => isRecord(value) && numberValue(value.index) === index);
    if (!entry) return null;
    const status = isRecord(entry[1]) ? entry[1] : {};
    const local = index === localIndex;
    const hp = local ? (numberValue(me?.health) ?? numberValue(status.health)) : numberValue(status.health);
    const xp = local ? numberValue(get(me, "xp", "current_xp")) : numberValue(status.xp);
    return {
      index, localPlayer: local,
      hp: known(hp), gold: known(local ? numberValue(me?.gold) : null),
      level: known(local ? numberValue(get(me, "xp", "level")) : null),
      xp: known(xp), alive: known(hp === null ? null : hp > 0),
      board: local ? mapSlots(board, "cell", 28) : { known: false, slots: [] },
      bench: local ? mapSlots(bench, "cell", 9) : { known: false, slots: [] },
      shop: local ? mapShop(shop) : { known: false, slots: [] },
      itemComponents: local ? mapComponents(itemBench, localSummoner, localRosterName) : known(null),
    };
  });
  return {
    contract: "tft.live-state", contractVersion: 1, matchId: known(matchId),
    stage: known(roundMatch ? Number(roundMatch[1]) : null),
    round: known(roundMatch ? Number(roundMatch[2]) : null),
    phase: known(textValue(get(info, "round_flow", "phase"))),
    localPlayerIndex: known(localIndex), players,
    carousel: mapCarousel(get(info, "carousel", "carousel", "carousel_pieces")),
  };
}
