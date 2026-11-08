import http from 'http';
import { URL } from 'url';
import { TftGepSnapshot } from './tft-snapshot.manager';

export interface TftBridgeHealth {
  ok: boolean;
  endpoint: string;
  statusCode?: number;
  message: string;
}

/**
 * Electron-side transport only. The Python receiver is implemented separately.
 * No credentials or account identifiers are added by this client.
 */
export class TftInferenceBridge {
  private readonly endpoint = process.env.TFT_IA_URL || 'http://127.0.0.1:8765';
  private pendingSnapshot: TftGepSnapshot | null = null;
  private sending = false;
  private retryAfter = 0;
  private lastFailureLogAt = 0;

  public sendSnapshot(snapshot: TftGepSnapshot): Promise<void> {
    if (Date.now() < this.retryAfter) return Promise.resolve();
    if (this.sending) {
      // Keep only the newest complete state; never build an unbounded backlog.
      this.pendingSnapshot = snapshot;
      return Promise.resolve();
    }
    this.sending = true;
    return this.deliver(snapshot).finally(() => {
      this.sending = false;
      const pending = this.pendingSnapshot;
      this.pendingSnapshot = null;
      if (pending && Date.now() >= this.retryAfter) {
        void this.sendSnapshot(pending).catch(() => undefined);
      }
    });
  }

  private async deliver(snapshot: TftGepSnapshot): Promise<void> {
    try {
      const result = await this.request('POST', '/v1/snapshot', snapshot);
      if (!result.ok) throw new Error(result.message);
      this.retryAfter = 0;
    } catch (error) {
      this.retryAfter = Date.now() + 5000;
      throw error;
    }
  }

  public async testConnection(): Promise<TftBridgeHealth> {
    try {
      const result = await this.request('GET', '/health');
      return {
        ok: result.ok,
        endpoint: this.endpoint,
        statusCode: result.statusCode,
        message: result.ok ? 'Python service responded to /health.' : result.message,
      };
    } catch (error) {
      return {
        ok: false,
        endpoint: this.endpoint,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  public shouldLogFailure(): boolean {
    const now = Date.now();
    if (now - this.lastFailureLogAt < 15000) return false;
    this.lastFailureLogAt = now;
    return true;
  }

  private request(method: string, route: string, body?: unknown): Promise<{
    ok: boolean; statusCode: number; message: string;
  }> {
    return new Promise((resolve, reject) => {
      const url = new URL(route, this.endpoint);
      const hostname = url.hostname.replace(/^\[|\]$/g, '');
      if (url.protocol !== 'http:' || url.username || url.password ||
          (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '::1')) {
        reject(new Error('TFT_IA_URL must point to localhost; remote endpoints are blocked.'));
        return;
      }
      const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf8');
      const request = http.request(url, {
        method,
        timeout: 1500,
        headers: data ? {
          'content-type': 'application/json',
          'content-length': data.length,
        } : undefined,
      }, response => {
        let responseBody = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { responseBody += chunk; });
        response.on('end', () => {
          const statusCode = response.statusCode ?? 0;
          resolve({
            ok: statusCode >= 200 && statusCode < 300,
            statusCode,
            message: responseBody.slice(0, 500) || `HTTP ${statusCode}`,
          });
        });
      });
      request.on('timeout', () => request.destroy(new Error('Local IA service timeout.')));
      request.on('error', reject);
      if (data) request.write(data);
      request.end();
    });
  }
}
