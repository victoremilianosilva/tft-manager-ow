const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

function load(relative) {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "browser", "services", "gep", relative), "utf8");
  const compiled = ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 });
  const module = { exports: {} };
  const localRequire = name => {
    if (name === "./tft-snapshot.manager") return { TftSnapshotManager: class {} };
    return require(name);
  };
  new Function("exports", "require", "module", compiled)(module.exports, localRequire, module);
  return module.exports;
}

async function main() {
  const { TftLiveInferenceBridge } = load("tft-live-inference.bridge.ts");
  const originalFetch = global.fetch;
  const requests = [];
  const statuses = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        status: "ready", snapshotReady: true,
        inferenceAvailable: false, executed: false, revision: 4,
      }),
    };
  };
  try {
    const bridge = new TftLiveInferenceBridge((status, details) => statuses.push({ status, details }));
    const snapshot = {
      schemaVersion: 2, gameId: 21570, sessionId: "session-a", revision: 4,
      capturedAt: "2026-11-08T16:00:00Z", complete: true,
      state: { contract: "tft.live-state", contractVersion: 1 },
    };
    await bridge.publish(snapshot);
    assert.strictEqual(requests.length, 1);
    assert.strictEqual(requests[0].url, "http://127.0.0.1:8765/v1/snapshot");
    assert.strictEqual(requests[0].options.method, "POST");
    assert.strictEqual(JSON.parse(requests[0].options.body).revision, 4);
    assert.strictEqual(requests[0].options.headers["X-TFT-Contract"], "tft.live-state/1");
    assert.strictEqual(statuses[0].status, "connected");
    assert.strictEqual(statuses[0].details.inferenceAvailable, false);

    assert.throws(() => new TftLiveInferenceBridge(() => undefined, "http://example.com/v1/snapshot"));
    assert.throws(() => new TftLiveInferenceBridge(() => undefined, "https://127.0.0.1/v1/snapshot"));
  } finally {
    global.fetch = originalFetch;
  }
  process.stdout.write("All TFT live inference bridge tests passed.\n");
}

main().catch(error => { process.stderr.write(String(error.stack || error) + "\n"); process.exitCode = 1; });
