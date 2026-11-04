const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const sourcePath = path.join(
  __dirname,
  '..',
  'src',
  'browser',
  'services',
  'gep',
  'tft-snapshot.manager.ts',
);
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpile(source, {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2019,
});
const loadedModule = { exports: {} };
new Function('exports', 'require', 'module', compiled)(
  loadedModule.exports,
  require,
  loadedModule,
);
const { TftSnapshotManager } = loadedModule.exports;

function test(name, fn) {
  try {
    fn();
    process.stdout.write('PASS ' + name + '\n');
  } catch (error) {
    process.stderr.write('FAIL ' + name + '\n');
    throw error;
  }
}

test('reconciliation applies getInfo baseline and marks snapshot complete', () => {
  const manager = new TftSnapshotManager(21570);
  manager.beginReconciliation();
  const snapshot = manager.finishReconciliation({
    info: {
      me: { gold: '42', health: '80', xp: '{"level":6,"current_xp":12}' },
      store: { shop_pieces: '{"slot_1":{"name":"TFT_Test"}}' },
    },
  });

  assert.strictEqual(snapshot.complete, true);
  assert.strictEqual(snapshot.info.me.gold, '42');
  assert.deepStrictEqual(snapshot.info.me.xp, { level: 6, current_xp: 12 });
  assert.deepStrictEqual(snapshot.info.store.shop_pieces, {
    slot_1: { name: 'TFT_Test' },
  });
  assert.strictEqual(snapshot.revision, 1);
});


test('nested JSON strings inside objects and arrays are normalized recursively', () => {
  const manager = new TftSnapshotManager(21570);
  manager.beginReconciliation();
  const snapshot = manager.finishReconciliation({
    info: {
      board: {
        pieces: '[{"unit":{"name":"TFT_Test","items":"[]"}}]',
      },
      me: {
        details: '{"rank":2,"stats":{"streak":3}}',
      },
    },
  });

  assert.deepStrictEqual(snapshot.info.board.pieces, [
    { unit: { name: 'TFT_Test', items: [] } },
  ]);
  assert.deepStrictEqual(snapshot.info.me.details, {
    rank: 2,
    stats: { streak: 3 },
  });
});

test('incremental updates preserve fields that did not change', () => {
  const manager = new TftSnapshotManager(21570);
  manager.beginReconciliation();
  manager.finishReconciliation({
    info: { me: { gold: '42', health: '80' } },
  });

  const snapshot = manager.applyInfoUpdate({
    info: { me: { gold: '38' } },
    feature: 'me',
  });

  assert.strictEqual(snapshot.info.me.gold, '38');
  assert.strictEqual(snapshot.info.me.health, '80');
  assert.strictEqual(snapshot.revision, 2);
});

test('updates received during getInfo are replayed after the baseline', () => {
  const manager = new TftSnapshotManager(21570);
  manager.beginReconciliation();
  manager.applyInfoUpdate({ info: { me: { gold: '35' } } });

  const snapshot = manager.finishReconciliation({
    info: { me: { gold: '40', health: '90' } },
  });

  assert.strictEqual(snapshot.info.me.gold, '35');
  assert.strictEqual(snapshot.info.me.health, '90');
  assert.strictEqual(snapshot.revision, 2);
  assert.strictEqual(snapshot.complete, true);
});

test('flat GEP update shape is normalized by feature and category', () => {
  const manager = new TftSnapshotManager(21570);
  manager.beginReconciliation();
  manager.finishReconciliation({ info: {} });

  const snapshot = manager.applyInfoUpdate({
    feature: 'board',
    category: 'board',
    key: 'board_pieces',
    value: '{"cell_1":{"name":"TFT_Test"}}',
  });

  assert.deepStrictEqual(snapshot.info.board.board.board_pieces, {
    cell_1: { name: 'TFT_Test' },
  });
});


test('getInfo reconciliation removes fields absent from the new baseline', () => {
  const manager = new TftSnapshotManager(21570);
  manager.beginReconciliation();
  manager.finishReconciliation({
    info: { me: { gold: '42', health: '80' } },
  });

  manager.beginReconciliation();
  const snapshot = manager.finishReconciliation({
    info: { me: { health: '75' } },
  });

  assert.strictEqual(snapshot.info.me.gold, undefined);
  assert.strictEqual(snapshot.info.me.health, '75');
  assert.strictEqual(snapshot.complete, true);
});

test('reset clears previous match data and revision', () => {
  const manager = new TftSnapshotManager(21570);
  manager.beginReconciliation();
  manager.finishReconciliation({ info: { me: { gold: '10' } } });

  const snapshot = manager.reset(21570);
  assert.strictEqual(snapshot.revision, 0);
  assert.strictEqual(snapshot.complete, false);
  assert.deepStrictEqual(snapshot.info, {});
});

process.stdout.write('All TFT snapshot manager tests passed.\n');
