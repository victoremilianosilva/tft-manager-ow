const assert = require('assert');
const crypto = require('crypto');
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

function verifyHashChain(lines) {
  let previous = '';
  lines.forEach((line, index) => {
    const record = JSON.parse(line);
    assert.strictEqual(record.sequence, index);
    assert.strictEqual(record.previous_record_sha256, previous || null);
    const marker = ',"record_sha256":';
    const markerIndex = line.lastIndexOf(marker);
    assert(markerIndex >= 0, 'record hash must be the final serialized field');
    const body = line.slice(0, markerIndex) + '}';
    const expected = crypto.createHash('sha256')
      .update(previous + body, 'utf8').digest('hex');
    assert.strictEqual(record.record_sha256, expected);
    previous = expected;
  });
  return previous;
}

(async () => {
  const recorder = new TftDualAuditRecorder(21570);
  await recorder.recordLifecycle(21570, 'game-detected', { name: 'TFT' });
  await recorder.recordRawGepEvent('new-info-update', 21570, {
    me: {
      gold: 42, credentials: { token: 'must-not-persist' },
      access_token: 'access-secret', api_key: 'key-secret',
      puuid: 'private-id', summoner_name: 'Private Player',
    },
    roster: { roster: { player_status: {
      'Private Player': { index: 0, localplayer: true },
      'Other Player': { index: 1, localplayer: false },
    } } },
    board: { cell_1: { name: 'TFT_TestUnit' } },
    battle_stats: [{ damage: 123 }],
    combat: { local_player_damage: 456 },
  });
  const snapshot = {
    schemaVersion: 2, gameId: 21570, sessionId: 'session-a', revision: 1,
    capturedAt: '2026-11-08T12:00:00.000Z', complete: true,
    state: {
      contract: 'tft.live-state', contractVersion: 1,
      matchId: { known: true, value: 'match-123' },
    },
  };
  await recorder.recordInferencePayload(snapshot);
  await recorder.recordInferencePayload({ ...snapshot, revision: 2 });
  await recorder.recordLifecycle(21570, 'game-exit', { name: 'TFT' });
  await recorder.close();

  const raw = appended.find(x => x.file.includes('tft-gep-raw-'));
  const inference = appended.filter(x => x.file.includes('tft-ia-payloads-'));
  assert(raw, 'legacy raw audit stream must remain available');
  assert.strictEqual(JSON.parse(raw.line).event, 'lifecycle:game-detected');
  assert.strictEqual(inference.length, 2, 'every canonical payload must remain recorded');
  const rawEvent = appended.find(x =>
    x.file.includes('tft-gep-raw-') && JSON.parse(x.line).event === 'new-info-update',
  );
  const rawJson = JSON.stringify(JSON.parse(rawEvent.line));
  assert.strictEqual(rawJson.includes('must-not-persist'), false);
  assert.strictEqual(rawJson.includes('private-id'), false);
  assert.strictEqual(rawJson.includes('access-secret'), false);
  assert.strictEqual(rawJson.includes('key-secret'), false);
  assert.strictEqual(rawJson.includes('Private Player'), false);
  assert.strictEqual(rawJson.includes('Other Player'), false);
  assert.strictEqual(rawJson.includes('battle_stats'), false);
  assert.strictEqual(rawJson.includes('local_player_damage'), false);

  const replayFile = recorder.getReplayFilePath();
  const replayLines = appended.filter(x => x.file === replayFile).map(x => x.line.trimEnd());
  assert(replayLines.length >= 6, 'manifest, lifecycle, raw, snapshots and footer must be captured');
  const finalHash = verifyHashChain(replayLines);
  const footer = JSON.parse(replayLines[replayLines.length - 1]);
  assert.strictEqual(footer.record_type, 'footer');
  assert.strictEqual(footer.payload.complete, true);
  assert.strictEqual(footer.payload.status, 'completed');
  assert.strictEqual(footer.payload.final_record_sha256, JSON.parse(replayLines[replayLines.length - 2]).record_sha256);
  assert.strictEqual(footer.record_sha256, finalHash);
  assert.strictEqual(JSON.parse(replayLines[0]).payload.replay_format, 'TFT_GEP_OBSERVATION_CAPTURE_V1');
  assert.strictEqual(JSON.parse(replayLines[0]).payload.deterministic_reexecution, false);

  const interrupted = new TftDualAuditRecorder(21570);
  await interrupted.recordLifecycle(21570, 'game-detected');
  await interrupted.recordError(21570, new Error('provider gap'));
  await interrupted.recordLifecycle(21570, 'game-exit');
  await interrupted.close();
  const interruptedLines = appended
    .filter(x => x.file === interrupted.getReplayFilePath())
    .map(x => x.line.trimEnd());
  verifyHashChain(interruptedLines);
  assert.strictEqual(JSON.parse(interruptedLines[interruptedLines.length - 1]).payload.complete, false);

  process.stdout.write('All TFT hash-chained GEP replay recorder tests passed.\n');
})().catch(error => {
  process.stderr.write(String(error && error.stack || error) + '\n');
  process.exitCode = 1;
});
