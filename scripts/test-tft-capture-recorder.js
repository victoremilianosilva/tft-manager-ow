const assert = require('assert');
const ts = require('typescript');
const appended = [];
let failNextAppend = false;
const fakeFs = { promises: {
  async mkdir() {},
  async appendFile(_file, line) {
    if (failNextAppend) { failNextAppend = false; throw new Error('simulated disk failure'); }
    appended.push(line);
  },
} };
const fakePath = { join: (...parts) => parts.join('/') };
const fakeElectron = { app: { getPath: () => '/tmp/tft-recorder-test' } };
const source = require('fs').readFileSync(
  require('path').join(__dirname, '..', 'src/browser/services/gep/tft-snapshot.recorder.ts'), 'utf8',
);
const compiled = ts.transpile(source, {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true,
});
const moduleObject = { exports: {} };
const mockedRequire = name => {
  if (name === 'fs') return fakeFs;
  if (name === 'path') return fakePath;
  if (name === 'electron') return fakeElectron;
  return require(name);
};
new Function('exports', 'require', 'module', compiled)(
  moduleObject.exports, mockedRequire, moduleObject,
);
const { TftSnapshotRecorder, sanitizeTftPayload } = moduleObject.exports;

(async () => {
  const recorder = new TftSnapshotRecorder();
  const base = {
    schemaVersion: 1, gameId: 21570, revision: 1,
    capturedAt: '2026-11-08T12:00:00.000Z', complete: true,
    info: { me: { gold: 50, health: 90 }, store: { shop_pieces: ['A', 'B'] } },
  };
  await recorder.record(base);
  await recorder.record({ ...base, capturedAt: '2026-11-08T12:00:01.000Z' });
  await recorder.record({
    ...base, revision: 2, capturedAt: '2026-11-08T12:00:02.000Z',
    info: { me: { gold: 45, health: 90 }, store: { shop_pieces: ['A', 'B'] } },
  });

  const parsed = appended.map(line => JSON.parse(line));
  assert.strictEqual(parsed.length, 2, 'identical state must not be written twice');
  assert.strictEqual(parsed[0].recordType, 'state_snapshot');
  assert.deepStrictEqual(parsed[0].state.me, { gold: 50, health: 90 });
  assert.strictEqual(parsed[1].recordType, 'state_delta');
  assert.deepStrictEqual(parsed[1].changes, { 'me.gold': 45 });
  assert.strictEqual(parsed[1].parentRevision, 1);
  assert.strictEqual(recorder.getFilePath().endsWith('.jsonl'), true);

  const sanitized = sanitizeTftPayload({
    lcu_info: { credentials: { token: 'secret' } },
    me: { puuid: 'private-id', account_id: 'private-account', gold: 10 },
  });
  const safeText = JSON.stringify(sanitized);
  assert.strictEqual(safeText.includes('secret'), false);
  assert.strictEqual(safeText.includes('private-id'), false);
  assert.strictEqual(safeText.includes('private-account'), false);
  assert.strictEqual(sanitized.me.gold, 10);

  failNextAppend = true;
  await assert.rejects(recorder.recordLifecycle(21570, 'disk_failure'));
  await recorder.recordLifecycle(21570, 'after_failure');
  assert.strictEqual(appended.length, 3, 'write queue should recover after failure');
  assert.strictEqual(JSON.parse(appended[2]).payload.event, 'after_failure');

  process.stdout.write('All TFT AI state recorder tests passed.\\n');
})().catch(error => {
  process.stderr.write(String(error && error.stack || error) + '\\n');
  process.exitCode = 1;
});
