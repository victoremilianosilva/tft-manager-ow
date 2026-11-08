const assert = require('assert');
const ts = require('typescript');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src/browser/services/gep/tft-game-id.ts'),
  'utf8',
);
const compiled = ts.transpile(source, {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2019,
});
const moduleObject = { exports: {} };
const mockedRequire = name => {
  if (name === '@overwolf/ow-electron-packages-types/gep-supported-games') {
    return { kGepSupportedGameIds: { TeamfightTactics: 21570 } };
  }
  return require(name);
};
new Function('exports', 'require', 'module', compiled)(
  moduleObject.exports,
  mockedRequire,
  moduleObject,
);
const { normalizeGepGameId, TFT_GEP_GAME_ID, TFT_OVERWOLF_GAME_ID } = moduleObject.exports;

assert.strictEqual(TFT_OVERWOLF_GAME_ID, 28164);
assert.strictEqual(TFT_GEP_GAME_ID, 21570);
assert.strictEqual(normalizeGepGameId(28164), 21570);
assert.strictEqual(normalizeGepGameId(21570), 21570);
assert.strictEqual(normalizeGepGameId(99999), 99999);

process.stdout.write('All TFT GEP game ID normalization tests passed.\n');
