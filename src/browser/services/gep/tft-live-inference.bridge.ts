import { TftGepSnapshot } from "./tft-snapshot.manager";

export interface LiveInferenceBridgeResult {
  status: string;
  snapshotReady: boolean;
  inferenceAvailable: boolean;
  executed: boolean;
  revision: number;
}

type StatusListener = (status: "connected" | "unavailable" | "rejected", details: unknown) => void;

const DEFAULT_ENDPOINT = "http://127.0.0.1:8765/v1/snapshot";
const MAX_ERROR_RETRY_MS = 5000;

function validateLoopbackEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("TFT live inference URL must be a valid URL");
  }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(hostname) ||
      url.pathname !== "/v1/snapshot" ||
      url.username || url.password) {
    throw new Error("TFT live inference endpoint must be the local /v1/snapshot HTTP endpoint");
  }
  return url.toString();
}

/**
 * Forwards the already-canonical snapshot from Electron's main process to the
 * local Python receiver. It never reads GEP and never executes policy actions.
 */
export class TftLiveInferenceBridge {
  private readonly endpoint: string;
  private retryAfter = 0;
  private lastStatus: string | null = null;

  constructor(
    private readonly onStatus: StatusListener = () => undefined,
    endpoint = process.env.TFT_LIVE_INFERENCE_URL || DEFAULT_ENDPOINT,
  ) {
    this.endpoint = validateLoopbackEndpoint(endpoint);
  }

  public async publish(snapshot: TftGepSnapshot): Promise<void> {
    if (Date.now() < this.retryAfter) return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "X-TFT-Contract": "tft.live-state/1",
        },
        body: JSON.stringify(snapshot),
        signal: controller.signal,
      });
      const result = await response.json() as LiveInferenceBridgeResult;
      if (!response.ok) {
        this.retryAfter = Date.now() + MAX_ERROR_RETRY_MS;
        this.notify("rejected", { httpStatus: response.status, result });
        return;
      }
      this.retryAfter = 0;
      this.notify("connected", result);
    } catch (error) {
      this.retryAfter = Date.now() + MAX_ERROR_RETRY_MS;
      this.notify("unavailable", error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timeout);
    }
  }

  private notify(status: "connected" | "unavailable" | "rejected", details: unknown): void {
    if (this.lastStatus === status) return;
    this.lastStatus = status;
    this.onStatus(status, details);
  }
}
