import { app, ipcMain } from 'electron';
import { PackageControllerBase } from '../base.controller';
import { GameEventsService } from '../../services/gep/game-events.service';
import { TftSnapshotRecorder, sanitizeTftPayload } from '../../services/gep/tft-snapshot.recorder';
import { OverwolfGameEventPackage } from '@overwolf/ow-electron-packages-types';
import { kGepSupportedGameIds } from '@overwolf/ow-electron-packages-types/gep-supported-games';

/** Connects Overwolf GEP events to the TFT capture service. */
export class GameEventsController extends PackageControllerBase {
  private _gepService: GameEventsService;
  private _gepApi: OverwolfGameEventPackage;
  private _snapshotRecorder: TftSnapshotRecorder;
  private _registeredGameIds: number[] = [];
  private _lastLoggedSnapshotRevision = -1;
  private _recorderPathLogged = false;
  private _gepListenersRegistered = false;

  constructor() {
    super('gep');
    this.registerToIpc();
  }

  protected onPackageReady(): void {
    // @ts-ignore - Overwolf injects the package API at runtime.
    this._gepApi = app.overwolf.packages.gep;
    if (!this._gepService) {
      this._gepService = new GameEventsService(this._gepApi);
      this._snapshotRecorder = new TftSnapshotRecorder();
      this._gepService.on('tft-features-ready', details => {
        this.log('TFT GEP features configured', details);
        void this._snapshotRecorder.recordLifecycle(kGepSupportedGameIds.TeamfightTactics, 'features-ready', details);
        this.emit('tft-features-ready', details);
      });
      this._gepService.on('tft-snapshot', snapshot => {
        if (
          snapshot.revision === 1 ||
          snapshot.revision - this._lastLoggedSnapshotRevision >= 25
        ) {
          this.log('TFT snapshot updated', {
            revision: snapshot.revision,
            complete: snapshot.complete,
            topLevelFeatures: Object.keys(snapshot.info ?? {}),
          });
          this._lastLoggedSnapshotRevision = snapshot.revision;
        }

        void this._snapshotRecorder.record(snapshot).then(() => {
          if (!this._recorderPathLogged) {
            this.log('TFT JSONL capture file', this._snapshotRecorder.getFilePath());
            this._recorderPathLogged = true;
          }
        }).catch(error => {
          this.error('Failed to persist TFT snapshot', error);
        });
        this.emit('tft-snapshot', snapshot);
      });
      this._gepService.on('tft-snapshot-incomplete', details => {
        this.warn('TFT snapshot baseline is incomplete', details);
        void this._snapshotRecorder.recordError(
          kGepSupportedGameIds.TeamfightTactics,
          'TFT snapshot baseline is incomplete',
          details,
        ).catch(() => undefined);
        this.emit('tft-snapshot-incomplete', details);
      });
      this._gepService.on('gep-error', details => {
        this.error('GEP capture error', details);
      });
      this._gepService.on('gep-retry', details => {
        this.warn('Retrying TFT GEP initialization', details);
        void this._snapshotRecorder.recordLifecycle(
          kGepSupportedGameIds.TeamfightTactics,
          'feature-initialization-retry',
          details,
        ).catch(() => undefined);
      });
    }

    if (!this._gepListenersRegistered) {
      this.registerToGepPackageEvents();
      this._gepListenersRegistered = true;
    }
    this.emit('ready');
  }

  public registerToGames(gameIds: number[]): void {
    this._registeredGameIds = gameIds;
    this._gepService.registerGames(gameIds);
    this.log('GEP game IDs registered', gameIds);
  }

  private registerToGepPackageEvents(): void {
    // Do not call removeAllListeners(): other package consumers may own listeners.
    this._gepApi.on('game-detected', (event, gameId, name) => {
      if (!this._registeredGameIds.includes(gameId)) {
        this.log('Ignoring unregistered GEP game', name, gameId);
        return;
      }
      this.log('Registered game detected', name, gameId);
      if (gameId === kGepSupportedGameIds.TeamfightTactics) {
        void this._snapshotRecorder.recordLifecycle(gameId, 'game-detected', { name });
      }
      void this._gepService.enableDetectedGame(event, gameId);
    });

    this._gepApi.on(
      'elevated-privileges-required',
      (event, gameId, name, pid) => {
        this.warn(
          `Elevated privileges required for game ${name} (gameId: ${gameId}, pid: ${pid})`,
        );
        if (gameId === kGepSupportedGameIds.TeamfightTactics) {
          void this._snapshotRecorder.recordLifecycle(gameId, 'elevated-privileges-required', { name, pid });
        }
      },
    );

    this._gepApi.on('new-info-update', (event, gameId, data) => {
      if (gameId === kGepSupportedGameIds.TeamfightTactics) {
        void this._snapshotRecorder.recordGepInfo(gameId, data).catch(error => {
          this.error('Failed to persist raw TFT GEP info update', error);
          void this._snapshotRecorder.recordError(gameId, error, args).catch(() => undefined);
        });
        this.log('TFT GEP info update', sanitizeTftPayload(data));
      }
      this._gepService.handleTftInfoUpdate(gameId, data);
      this.emit('gep-info', { gameId, data: gameId === kGepSupportedGameIds.TeamfightTactics ? sanitizeTftPayload(data) : data });
    });

    this._gepApi.on('new-game-event', (event, gameId, data) => {
      if (gameId === kGepSupportedGameIds.TeamfightTactics) {
        void this._snapshotRecorder.recordGepEvent(gameId, data).catch(error => {
          this.error('Failed to persist raw TFT GEP game event', error);
          void this._snapshotRecorder.recordError(gameId, error, args).catch(() => undefined);
        });
        this.log('TFT GEP game event', sanitizeTftPayload(data));
      }
      this.emit('gep-event', { gameId, data: gameId === kGepSupportedGameIds.TeamfightTactics ? sanitizeTftPayload(data) : data });
    });

    this._gepApi.on('error', (event, gameId, error, ...args) => {
      this.error(`GEP error for game ${gameId}: ${error}`, ...args);
      if (gameId === kGepSupportedGameIds.TeamfightTactics) {
        void this._snapshotRecorder.recordError(gameId, error).catch(() => undefined);
      }
      this.emit('gep-error', { gameId, error, args });
    });

    this._gepApi.on('game-exit', (event, gameId, name, pid) => {
      this.log(`Game exit: ${name} (gameId: ${gameId}, pid: ${pid})`);
      if (gameId === kGepSupportedGameIds.TeamfightTactics) {
        void this._snapshotRecorder.recordLifecycle(gameId, 'game-exit', { name, pid });
        this._lastLoggedSnapshotRevision = -1;
        this._recorderPathLogged = false;
      }
      this._gepService.onGameExit(gameId);
    });
  }

  private registerToIpc(): void {
    ipcMain.handle('gep-set-required-feature', async () => {
      await this._gepService.setRequiredFeaturesForAllSupportedGames();
      return true;
    });

    ipcMain.handle('gep-getInfo', async () => {
      return this._gepService.getInfoForActiveGame();
    });
  }
}
