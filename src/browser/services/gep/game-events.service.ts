import {
  GepGameLaunchEvent,
  OverwolfGameEventPackage,
} from '@overwolf/ow-electron-packages-types';
import { kGepSupportedGameIds } from '@overwolf/ow-electron-packages-types/gep-supported-games';
import EventEmitter from 'events';
import { TftSnapshotManager } from './tft-snapshot.manager';

/**
 * TFT GEP feature allowlist. Augments are intentionally excluded because
 * Overwolf's TFT documentation warns third-party apps not to display them.
 */
export const TFT_REQUIRED_FEATURES = [
  'gep_internal',
  'game_flow',
  'game_info',
  'me',
  'match_info',
  'roster',
  'store',
  'board',
  'bench',
  'carousel',
  'match_stats',
  'end_game',
] as const;

export class GameEventsService extends EventEmitter {
  private _gepApi: OverwolfGameEventPackage;
  private _activeGame = 0;
  private _gepGamesId: number[] = [];
  private _tftSnapshotManager?: TftSnapshotManager;

  constructor(gepApi: OverwolfGameEventPackage) {
    super();
    this._gepApi = gepApi;
  }

  public registerGames(gepGamesId: number[]): void {
    this._gepGamesId = gepGamesId;
  }

  public async enableDetectedGame(
    event: GepGameLaunchEvent,
    gameId: number,
  ): Promise<void> {
    event.enable();
    this._activeGame = gameId;

    try {
      if (gameId === kGepSupportedGameIds.TeamfightTactics) {
        await this.initializeTftCaptureWithRetry(gameId);
      } else {
        await this._gepApi.setRequiredFeatures(gameId, undefined);
      }
    } catch (error) {
      this.emit('gep-error', { gameId, error });
      console.error('[GEP] Failed to enable game features', error);
    }
  }

  public onGameExit(gameId?: number): void {
    if (gameId !== undefined && gameId !== this._activeGame) return;
    this._activeGame = 0;
    this._tftSnapshotManager?.markIncomplete();
    this._tftSnapshotManager = undefined;
    this.emit('tft-snapshot-reset');
  }

  public handleTftInfoUpdate(gameId: number, data: unknown): void {
    if (
      gameId !== kGepSupportedGameIds.TeamfightTactics ||
      !this._tftSnapshotManager
    ) return;

    const snapshot = this._tftSnapshotManager.applyInfoUpdate(data);
    if (snapshot) this.emit('tft-snapshot', snapshot);
  }

  private async initializeTftCaptureWithRetry(gameId: number, attempts = 3): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await this.initializeTftCapture(gameId);
        return;
      } catch (error) {
        lastError = error;
        this.emit('gep-retry', { gameId, attempt, attempts, error });
        if (attempt < attempts) {
          await new Promise(resolve => setTimeout(resolve, 500 * attempt));
        }
      }
    }
    throw lastError;
  }

  private async initializeTftCapture(gameId: number): Promise<void> {
    const supported = await this._gepApi.getFeatures(gameId);
    const required = TFT_REQUIRED_FEATURES.filter(feature =>
      supported.includes(feature),
    );

    if (required.length === 0) {
      throw new Error(
        'GEP returned no supported TFT features required for snapshots.',
      );
    }

    const manager = new TftSnapshotManager(gameId);
    this._tftSnapshotManager = manager;
    manager.beginReconciliation();
    await this._gepApi.setRequiredFeatures(gameId, required);

    this.emit('tft-features-ready', {
      gameId,
      requested: [...TFT_REQUIRED_FEATURES],
      supported,
      enabled: required,
      unavailable: TFT_REQUIRED_FEATURES.filter(
        feature => !supported.includes(feature),
      ),
    });

    // Updates arriving while getInfo() is in flight are replayed after the
    // baseline so that the newest values take precedence.
    try {
      const baseline = await this._gepApi.getInfo(gameId);
      if (this._tftSnapshotManager !== manager) return;
      this.emit('tft-snapshot', manager.finishReconciliation(baseline));
    } catch (error) {
      if (this._tftSnapshotManager === manager) manager.markIncomplete();
      this.emit('tft-snapshot-incomplete', { gameId, error });
      throw error;
    }
  }

  /**
   * Re-read getInfo() and reconcile it with the live delta stream.
   * This is exposed for diagnostics so a real capture can be checked against
   * the provider's current stored state without discarding in-flight updates.
   */
  public async reconcileTftSnapshot() {
    if (
      this._activeGame !== kGepSupportedGameIds.TeamfightTactics ||
      !this._tftSnapshotManager
    ) return null;

    const manager = this._tftSnapshotManager;
    const gameId = this._activeGame;
    manager.beginReconciliation();
    try {
      const baseline = await this._gepApi.getInfo(gameId);
      if (this._tftSnapshotManager !== manager || this._activeGame !== gameId) {
        return null;
      }
      const snapshot = manager.finishReconciliation(baseline);
      this.emit('tft-snapshot', snapshot);
      return snapshot;
    } catch (error) {
      if (this._tftSnapshotManager === manager) manager.markIncomplete();
      this.emit('tft-snapshot-incomplete', {
        gameId: this._activeGame,
        error,
      });
      throw error;
    }
  }

  public getTftSnapshot() {
    return this._tftSnapshotManager?.getSnapshot() ?? null;
  }

  public async getInfoForActiveGame(): Promise<any> {
    if (this._activeGame === 0) return null;
    if (this._activeGame === kGepSupportedGameIds.TeamfightTactics) {
      return this.reconcileTftSnapshot();
    }
    try {
      return await this._gepApi.getInfo(this._activeGame);
    } catch (error) {
      console.error('[GEP] getInfo failed', error);
      return null;
    }
  }

  public async setRequiredFeaturesForAllSupportedGames(): Promise<void> {
    if (!this._gepApi) return;
    for (const gameId of this._gepGamesId) {
      if (gameId === kGepSupportedGameIds.TeamfightTactics) {
        await this.initializeTftCaptureWithRetry(gameId);
      }
    }
  }
}
