# Electron local IA bridge

The Overwolf/Electron app now contains the transport client for a local TFT IA service.
The Python receiver is intentionally a separate follow-up and is not included here.

## Contract

- Base URL: `TFT_IA_URL` environment variable, default `http://127.0.0.1:8765`.
- Health check: `GET /health`.
- Snapshot delivery: `POST /v1/snapshot`.
- Body: the complete canonical `tft.live-state` snapshot envelope (JSON).
- No authentication headers, credentials, or remote hosts are supported. The client rejects non-loopback URLs.

Every canonical snapshot is still written to `tft-ia-payloads-*.jsonl` independently of delivery. Raw GEP capture is unchanged. If Python is not running, delivery fails non-fatally, the JSONL capture continues, and a throttled warning is written to the app log. To avoid an unbounded memory backlog, the transport allows one in-flight request and coalesces pending deliveries to the newest complete snapshot. The JSONL files remain the lossless audit source for every captured event/snapshot.

## In-app diagnostic

Open the TFT GEP Capture log page and click **Testar comunicação IA**. It calls `GET /health` and displays the endpoint, HTTP status, and result. A successful health check only confirms that a local service responds; it does not prove that the Python policy or C++ engine is loaded. Those deeper checks belong to the Python/runtime follow-up.

## Local development

Set `TFT_IA_URL` only when launching Electron if a different loopback port is needed. Do not configure a remote URL. The default endpoint is deliberately loopback-only.
