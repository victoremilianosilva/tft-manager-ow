const assert = require('assert');
const ts = require('typescript');

const appended = [];
let failNextAppend = false;
const fakeFs = {
  promises: {
    async mkdir() {},
    async appendFile(_file, line) {
      if (failNextAppend) {
        failNextAppend = false;
        throw new Error('simulated disk failure');
      }
      appended.push(line);
    },
  },
};
const fakePath = { join: (...parts) => parts.join('/') };
const fakeElectron = { app: { getPath: () => '/tmp/tft-recorder-test' } };

const source = require('fs').readFileSync(
  require('path').join(__dirname, '..', 'src/browser/services/gep/tft-snapshot.recorder.ts'),
  'utf8',
);
const compiled = ts.transpile(source, {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2019,
  esModuleInterop: true,
});
const moduleObject = { exports: {} };
const mockedRequire = (name) => {
  if (name === 'fs') return fakeFs;
  if (name === 'path') return fakePath;
  if (name === 'electron') return fakeElectron;
  return require(name);
};
new Function('exports', 'require', 'module', compiled)(
  moduleObject.exports,
  mockedRequire,
  moduleObject,
);
const { TftSnapshotRecorder } = moduleObject.exports;

(async () => {
  const recorder = new TftSnapshotRecorder();
  await recorder.recordGepInfo(21570, {
    info: { match_info: { match_id: 'match-123' }, me: { gold: 50 } },
  });
  await recorder.recordGepEvent(21570, {
    event: 'round_start',
    match_id: 'match-123',
    augments: ['must-not-be-displayed'],
  });

  const parsed = appended.map(line => JSON.parse(line));
  assert.strictEqual(parsed.length, 2);
  assert.strictEqual(parsed[0].recordType, 'info_update');
  assert.strictEqual(parsed[1].recordType, 'game_event');
  assert.strictEqual(parsed[0].matchId, 'match-123');
  assert.strictEqual(parsed[1].matchId, 'match-123');
  assert.strictEqual(parsed[1].payload.augments, '[redacted: Overwolf TFT GEP display restriction]');
  assert.strictEqual(recorder.getFilePath().endsWith('.jsonl'), true);

  failNextAppend = true;
  await assert.rejects(recorder.recordGepEvent(21570, { event: 'disk_failure' }));
  await recorder.recordGepEvent(21570, { event: 'after_failure' });
  assert.strictEqual(appended.length, 3, 'queue should recover after a failed append');
  assert.strictEqual(JSON.parse(appended[2]).payload.event, 'after_failure');

  process.stdout.write('All TFT capture recorder tests passed.\\n');
})().catch(error => {
  process.stderr.write(String(error && error.stack || error) + '\\n');
  process.exitCode = 1;
});
