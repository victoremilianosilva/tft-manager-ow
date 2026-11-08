const assert = require('assert');
const ts = require('typescript');
const appended = [];
const fakeFs = { promises: {
  async mkdir() {},
  async appendFile(file, line) { appended.push({ file, line }); },
} };
const fakePath = { join: (...parts) => parts.join('/') };
const fakeElectron = { app: { getPath: () => '/tmp/tft-audit-test' } };
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
new Function('exports', 'require', 'module', compiled)(moduleObject.exports, mockedRequire, moduleObject);
const { TftDualAuditRecorder } = moduleObject.exports;
(async () => {
  const recorder = new TftDualAuditRecorder();
  await recorder.recordRawGepEvent('new-info-update', 21570, {
    me: { gold: 42, credentials: { token: 'must-not-persist' }, access_token: 'access-secret', api_key: 'key-secret', puuid: 'private-id' },
    board: { cell_1: { name: 'TFT_TestUnit' } },
  });
  const snapshot = {
    schemaVersion: 2, gameId: 21570, sessionId: 'session-a', revision: 1,
    capturedAt: '2026-11-08T12:00:00.000Z', complete: true,
    state: { contract: 'tft.live-state', contractVersion: 1 },
  };
  await recorder.recordInferencePayload(snapshot);
  await recorder.recordInferencePayload({ ...snapshot, revision: 2 });
  assert.strictEqual(appended.length, 3, 'every raw event and every canonical payload must be recorded');
  const raw = JSON.parse(appended[0].line);
  assert.strictEqual(raw.event, 'new-info-update');
  assert.strictEqual(raw.payload.me.gold, 42);
  assert.strictEqual(JSON.stringify(raw).includes('must-not-persist'), false);
  assert.strictEqual(JSON.stringify(raw).includes('private-id'), false);
  assert.strictEqual(JSON.stringify(raw).includes('access-secret'), false);
  assert.strictEqual(JSON.stringify(raw).includes('key-secret'), false);
  assert.strictEqual(JSON.parse(appended[1].line).payload.revision, 1);
  assert.strictEqual(JSON.parse(appended[2].line).payload.revision, 2);
  assert.notStrictEqual(recorder.getRawFilePath(), recorder.getInferenceFilePath());
  assert(appended[0].file.includes('tft-gep-raw-'));
  assert(appended[1].file.includes('tft-ia-payloads-'));
  assert(appended.every(x => x.line.endsWith('\n')), 'each record must be one valid JSONL line');
  process.stdout.write('All TFT dual audit recorder tests passed.\n');
})().catch(error => {
  process.stderr.write(String(error && error.stack || error) + '\n');
  process.exitCode = 1;
});
