const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
function load(relative) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'browser', 'services', 'gep', relative), 'utf8');
  const compiled = ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 });
  const module = { exports: {} };
  const localRequire = name => {
    if (name === './tft-live-state.mapper') return mapperModule.exports;
    return require(name);
  };
  new Function('exports', 'require', 'module', compiled)(module.exports, localRequire, module);
  return module;
}
const mapperSource = fs.readFileSync(path.join(__dirname, '..', 'src/browser/services/gep/tft-live-state.mapper.ts'), 'utf8');
const mapperCompiled = ts.transpile(mapperSource, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 });
const mapperModule = { exports: {} };
new Function('exports', 'require', 'module', mapperCompiled)(mapperModule.exports, require, mapperModule);
const { TftSnapshotManager } = load('tft-snapshot.manager.ts').exports;
function test(name, fn) { try { fn(); process.stdout.write('PASS ' + name + '\\n'); } catch (error) { process.stderr.write('FAIL ' + name + '\\n'); throw error; } }
function fixture() {
 return { info: {
  me: { me: { health: '84', gold: '35', xp: { level: 4, current_xp: 4, xp_max: 10 } } },
  roster: { roster: { player_status: {
   Alpha: { index: 0, health: 81, xp: 5, localplayer: false },
   Local: { index: 1, health: 84, xp: 4, localplayer: true },
   Beta: { index: 2, health: 97, xp: 4, localplayer: false }
  } } },
  match_info: { match_info: { round_type: { stage: '2-6', type: 'PVP' } } },
  board: { board: { board_pieces: { cell_1: { name: 'TFT_TestA', level: '2', item_1: 'DA_InfinityEdge', item_2: '', item_3: '' }, cell_28: { name: 'TFT_TestB', level: '1' } } } },
  bench: { bench: { bench_pieces: { cell_1: { name: 'TFT_TestC', level: '1' } }, item_bench: [{ summoner: 'Local', bench_items: [{ name: 'DA_Component_BFSword', count: 2 }, { name: 'DA_Component_RecurveBow', count: 1 }] }] } },
  store: { store: { shop_pieces: { slot_1: { name: 'TFT_TestD' }, slot_2: {}, slot_3: {}, slot_4: {}, slot_5: {} } } },
  carousel: { carousel: { carousel_pieces: { slot_1: { item_1: 'DA_Component_GiantsBelt', item_2: '' } } } }
 } };
}
test('publishes schema v2 canonical state, not raw GEP info', () => {
 const manager = new TftSnapshotManager(21570); manager.beginReconciliation();
 const snapshot = manager.finishReconciliation(fixture());
 assert.strictEqual(snapshot.schemaVersion, 2); assert.strictEqual(snapshot.complete, true);
 assert.ok(snapshot.state); assert.strictEqual(snapshot.info, undefined);
 assert.strictEqual(snapshot.state.stage.value, 2); assert.strictEqual(snapshot.state.round.value, 6);
 assert.strictEqual(snapshot.state.localPlayerIndex.value, 1);
 const local = snapshot.state.players[1];
 assert.strictEqual(local.localPlayer, true); assert.strictEqual(local.hp.value, 84);
 assert.strictEqual(local.gold.value, 35); assert.strictEqual(local.level.value, 4); assert.strictEqual(local.xp.value, 4);
 assert.strictEqual(local.board.slots.length, 28); assert.strictEqual(local.board.slots[0].unit.apiName, 'TFT_TestA');
 assert.strictEqual(local.board.slots[27].unit.apiName, 'TFT_TestB');
 assert.strictEqual(local.bench.slots.length, 9); assert.strictEqual(local.shop.slots[0].value, 'TFT_TestD');
 assert.deepStrictEqual(local.itemComponents.value, [{ apiName: 'DA_Component_BFSword', count: 2 }, { apiName: 'DA_Component_RecurveBow', count: 1 }]);
 assert.strictEqual(snapshot.state.players[0].board.known, false);
});
test('buffers deltas during baseline and applies newest value', () => {
 const manager = new TftSnapshotManager(21570); manager.beginReconciliation();
 manager.applyInfoUpdate({ feature: 'me', category: 'me', key: 'gold', value: '35' });
 const snapshot = manager.finishReconciliation(fixture());
 assert.strictEqual(snapshot.state.players[1].gold.value, 35);
});
test('semantic duplicates do not increment revision', () => {
 const manager = new TftSnapshotManager(21570); manager.beginReconciliation(); manager.finishReconciliation(fixture());
 const revision = manager.getSnapshot().revision;
 assert.strictEqual(manager.applyInfoUpdate({ info: { me: { me: { gold: '35' } } } }), null);
 assert.strictEqual(manager.getSnapshot().revision, revision);
});
test('sensitive fields and combat telemetry never appear in canonical output', () => {
 const manager = new TftSnapshotManager(21570); manager.beginReconciliation();
 const input = fixture(); input.info.me.me.puuid = 'secret'; input.info.match_info.match_info.battle_stats = [{ damage: 123 }];
 const snapshot = manager.finishReconciliation(input);
 const json = JSON.stringify(snapshot);
 assert.strictEqual(json.includes('secret'), false); assert.strictEqual(json.includes('battle_stats'), false);
});
test('unknown domains remain explicitly unknown, not fabricated', () => {
 const manager = new TftSnapshotManager(21570); manager.beginReconciliation();
 const snapshot = manager.finishReconciliation({ info: { me: { me: { gold: '10' } } } });
 assert.strictEqual(snapshot.state.players[0], null);
 assert.strictEqual(snapshot.state.players.every(p => p === null || p.board.known === false), true);
});
process.stdout.write('All canonical TFT state mapper tests passed.\\n');
