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
  private queue: Promise<void> = Promise.resolve();
  private lastFailureLogAt = 0;

  public sendSnapshot(snapshot: TftGepSnapshot): Promise<void> {
    this.queue = this.queue.catch(() => undefined).then(async () => {
      const result = await this.request('POST', '/v1/snapshot', snapshot);
      if (!result.ok) throw new Error(result.message);
    });
    return this.queue;
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
      if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost' && url.hostname !== '::1') {
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
