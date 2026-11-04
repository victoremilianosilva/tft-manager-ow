import { app, ipcMain } from 'electron';
import { PackageControllerBase } from '../base.controller';
import { GameEventsService } from '../../services/gep/game-events.service';
import { OverwolfGameEventPackage } from '@overwolf/ow-electron-packages-types';

/** Connects Overwolf GEP events to the TFT capture service. */
export class GameEventsController extends PackageControllerBase {
  private _gepService: GameEventsService;
  private _gepApi: OverwolfGameEventPackage;
  private _registeredGameIds: number[] = [];

  constructor() {
    super('gep');
    this.registerToIpc();
  }

  protected onPackageReady(): void {
    // @ts-ignore - Overwolf injects the package API at runtime.
    this._gepApi = app.overwolf.packages.gep;
    if (!this._gepService) {
      this._gepService = new GameEventsService(this._gepApi);
      this._gepService.on('tft-features-ready', details => {
        this.log('TFT GEP features configured', details);
        this.emit('tft-features-ready', details);
      });
      this._gepService.on('tft-snapshot', snapshot => {
        this.emit('tft-snapshot', snapshot);
      });
      this._gepService.on('tft-snapshot-incomplete', details => {
        this.warn('TFT snapshot baseline is incomplete', details);
        this.emit('tft-snapshot-incomplete', details);
      });
      this._gepService.on('gep-error', details => {
        this.error('GEP capture error', details);
      });
    }

    this.registerToGepPackageEvents();
    this.emit('ready');
  }

  public registerToGames(gameIds: number[]): void {
    this._registeredGameIds = gameIds;
    this._gepService.registerGames(gameIds);
  }

  private registerToGepPackageEvents(): void {
    // Do not call removeAllListeners(): other package consumers may own listeners.
    this._gepApi.on('game-detected', (event, gameId, name) => {
      if (!this._registeredGameIds.includes(gameId)) {
        this.log('Ignoring unregistered GEP game', name, gameId);
        return;
      }
      this.log('Registered game detected', name, gameId);
      void this._gepService.enableDetectedGame(event, gameId);
    });

    this._gepApi.on(
      'elevated-privileges-required',
      (event, gameId, name, pid) => {
        this.warn(
          `Elevated privileges required for game ${name} (gameId: ${gameId}, pid: ${pid})`,
        );
      },
    );

    this._gepApi.on('new-info-update', (event, gameId, data) => {
      this._gepService.handleTftInfoUpdate(gameId, data);
      // Preserve the raw GEP event channel for existing diagnostics consumers.
      this.emit('gep-info', { gameId, data });
    });

    this._gepApi.on('new-game-event', (event, gameId, data) => {
      this.emit('gep-event', { gameId, data });
    });

    this._gepApi.on('error', (event, gameId, error, ...args) => {
      this.error(`GEP error for game ${gameId}: ${error}`, ...args);
      this.emit('gep-error', { gameId, error, args });
    });

    this._gepApi.on('game-exit', (event, gameId, name, pid) => {
      this.log(`Game exit: ${name} (gameId: ${gameId}, pid: ${pid})`);
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
