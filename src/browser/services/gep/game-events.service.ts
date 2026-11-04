import {
  GepGameLaunchEvent,
  OverwolfGameEventPackage,
} from '@overwolf/ow-electron-packages-types';
import { kGepSupportedGameIds } from '@overwolf/ow-electron-packages-types/gep-supported-games';
import EventEmitter from 'events';
import { TftSnapshotManager } from './tft-snapshot.manager';

/**
 * TFT-specific features used by the decision engine.
 *
 * Augments are intentionally excluded: Overwolf's TFT documentation warns
 * that third-party apps must not display augment data under Riot's ToS.
 * live_client_data is also excluded because it exposes the LoL live-client
 * data model rather than the structured TFT board/economy model.
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

/** Service responsible for GEP registration and TFT snapshot initialization. */
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
        await this.initializeTftCapture(gameId);
      } else {
        // Preserve the sample app's behavior for its other registered games.
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
    this.emit('tft-snapshot', snapshot);
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

    this._tftSnapshotManager = new TftSnapshotManager(gameId);
    this._tftSnapshotManager.beginReconciliation();

    // Subscribe only to features that this installed GEP version supports.
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

    // Deltas may arrive while getInfo() is in flight. SnapshotManager buffers
    // them and replays them over the baseline so newer updates take priority.
    try {
      const baseline = await this._gepApi.getInfo(gameId);
      const snapshot = this._tftSnapshotManager.finishReconciliation(baseline);
      this.emit('tft-snapshot', snapshot);
    } catch (error) {
      this._tftSnapshotManager.markIncomplete();
      this.emit('tft-snapshot-incomplete', { gameId, error });
      throw error;
    }
  }

  /** Current snapshot, exposed for diagnostics and later IPC integration. */
  public getTftSnapshot() {
    return this._tftSnapshotManager?.getSnapshot() ?? null;
  }

  /** Retained as a diagnostic method; do not log raw game data. */
  public async getInfoForActiveGame(): Promise<any> {
    if (this._activeGame === 0) return null;
    try {
      return await this._gepApi.getInfo(this._activeGame);
    } catch (error) {
      console.error('[GEP] getInfo failed', error);
      return null;
    }
  }

  /** Kept for the existing QA IPC entry point, but no longer enables all features. */
  public async setRequiredFeaturesForAllSupportedGames(): Promise<void> {
    if (!this._gepApi) return;
    for (const gameId of this._gepGamesId) {
      if (gameId === kGepSupportedGameIds.TeamfightTactics) {
        await this.initializeTftCapture(gameId);
      }
    }
  }
}
