import { app, ipcMain } from 'electron';
import { PackageControllerBase } from '../base.controller';
import { GameEventsService } from '../../services/gep/game-events.service';
import { TftDualAuditRecorder } from '../../services/gep/tft-snapshot.recorder';
import { OverwolfGameEventPackage } from '@overwolf/ow-electron-packages-types';
import { kGepSupportedGameIds } from '@overwolf/ow-electron-packages-types/gep-supported-games';
import { normalizeGepGameId } from '../../services/gep/tft-game-id';

/** Connects Overwolf GEP events to the TFT capture service. */
export class GameEventsController extends PackageControllerBase {
  private _gepService: GameEventsService;
  private _gepApi: OverwolfGameEventPackage;
  private _auditRecorder: TftDualAuditRecorder;
  private _registeredGameIds: number[] = [];
  private _lastLoggedSnapshotRevision = -1;
  private _gepListenersRegistered = false;

  constructor() {
    super('gep');
    this.registerToIpc();
  }

  protected onPackageReady(): void {
    // @ts-ignore - Overwolf injects the package API at runtime.
    this._gepApi = app.overwolf.packages.gep;
    this.log('GEP package ready; attaching TFT detection listeners');
    if (!this._gepService) {
      this._gepService = new GameEventsService(this._gepApi);
      this._auditRecorder = new TftDualAuditRecorder();
      this.log('TFT raw GEP JSONL', this._auditRecorder.getRawFilePath());
      this.log('TFT canonical IA JSONL', this._auditRecorder.getInferenceFilePath());
      this._gepService.on('tft-features-ready', details => {
        this.log('TFT GEP features configured', details);
        void this._auditRecorder.recordLifecycle(kGepSupportedGameIds.TeamfightTactics, 'features-ready', details);
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
            contract: snapshot.state.contract,
            playerCount: snapshot.state.players.filter(Boolean).length,
            localPlayerIndex: snapshot.state.localPlayerIndex.value,
          });
          this._lastLoggedSnapshotRevision = snapshot.revision;
        }

        // Persist every complete canonical payload that would be supplied to IA.
        void this._auditRecorder.recordInferencePayload(snapshot).catch(error => {
          this.error('Failed to persist canonical IA payload', error);
        });
        this.emit('tft-snapshot', snapshot);
      });
      this._gepService.on('tft-snapshot-incomplete', details => {
        this.warn('TFT snapshot baseline is incomplete', details);
        void this._auditRecorder.recordError(
          kGepSupportedGameIds.TeamfightTactics,
          'TFT snapshot baseline is incomplete',
          details,
        ).catch(() => undefined);
        this.emit('tft-snapshot-incomplete', details);
      });
      this._gepService.on('gep-error', details => {
        this.error('GEP capture error', details);
        void this._auditRecorder.recordError(
          kGepSupportedGameIds.TeamfightTactics,
          (details as any)?.error ?? 'GEP capture error',
          details,
        ).catch(() => undefined);
      });
      this._gepService.on('gep-retry', details => {
        this.warn('Retrying TFT GEP initialization', details);
        void this._auditRecorder.recordLifecycle(
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
    this.log('TFT detection registration status', {
      tftGameId: kGepSupportedGameIds.TeamfightTactics,
      tftRegistered: gameIds.includes(kGepSupportedGameIds.TeamfightTactics),
      listenerCounts: {
        gameDetected: this._gepApi.listenerCount('game-detected'),
        gameExit: this._gepApi.listenerCount('game-exit'),
        infoUpdate: this._gepApi.listenerCount('new-info-update'),
        gameEvent: this._gepApi.listenerCount('new-game-event'),
      },
    });
    void this._gepApi.getSupportedGames().then(games => {
      this.log('GEP supported games reported by provider', games);
    }).catch(error => {
      this.error('Unable to query GEP supported games', error);
    });
  }

  private registerToGepPackageEvents(): void {
    // Do not call removeAllListeners(): other package consumers may own listeners.
    this._gepApi.on('game-detected', (event, reportedGameId, name) => {
      const gameId = normalizeGepGameId(reportedGameId);
      const registered = this._registeredGameIds.includes(gameId);
      this.log('GEP game-detected event received', {
        reportedGameId,
        canonicalGepGameId: gameId,
        name,
        registered,
      });
      if (!registered) {
        this.log('Ignoring unregistered GEP game', { name, reportedGameId, canonicalGepGameId: gameId });
        return;
      }

      this.log('Registered GEP game detected', { name, reportedGameId, canonicalGepGameId: gameId });
      if (gameId === kGepSupportedGameIds.TeamfightTactics) {
        this.log('TFT CLIENT IDENTIFIED BY GEP', { name, reportedGameId, canonicalGepGameId: gameId });
        // Create the session JSONL at detection time, before waiting for the
        // first info update or baseline snapshot.
        void this._auditRecorder.recordLifecycle(gameId, 'game-detected', {
          name,
          reportedGameId,
          canonicalGepGameId: gameId,
        });
      }
      void this._gepService.enableDetectedGame(event, gameId);
    });

    this._gepApi.on(
      'elevated-privileges-required',
      (event, reportedGameId, name, pid) => {
        const gameId = normalizeGepGameId(reportedGameId);
        this.warn(
          `Elevated privileges required for game ${name} (reportedGameId: ${reportedGameId}, canonicalGepGameId: ${gameId}, pid: ${pid})`,
        );
        if (gameId === kGepSupportedGameIds.TeamfightTactics) {
          void this._auditRecorder.recordLifecycle(gameId, 'elevated-privileges-required', {
            name,
            pid,
            reportedGameId,
            canonicalGepGameId: gameId,
          });
        }
      },
    );

    this._gepApi.on('new-info-update', (event, reportedGameId, data) => {
      const gameId = normalizeGepGameId(reportedGameId);
      if (gameId === kGepSupportedGameIds.TeamfightTactics) {
        // Persist the original GEP update before projecting it into canonical state.
        void this._auditRecorder.recordRawGepEvent('new-info-update', gameId, data).catch(error => {
          this.error('Failed to persist raw GEP info update', error);
        });
        this._gepService.handleTftInfoUpdate(gameId, data);
      }
      // TFT consumers receive only the canonical tft-snapshot contract.
      if (gameId !== kGepSupportedGameIds.TeamfightTactics) {
        this.emit('gep-info', { gameId, data });
      }
    });

    this._gepApi.on('new-game-event', (event, reportedGameId, data) => {
      const gameId = normalizeGepGameId(reportedGameId);
      // Preserve raw GEP event JSON for later action reconstruction and comparison.
      if (gameId === kGepSupportedGameIds.TeamfightTactics) {
        void this._auditRecorder.recordRawGepEvent('new-game-event', gameId, data).catch(error => {
          this.error('Failed to persist raw GEP game event', error);
        });
        this._gepService.handleTftGameEvent(gameId, data);
      } else {
        this.emit('gep-event', { gameId, data });
      }
    });

    this._gepApi.on('error', (event, reportedGameId, error, ...args) => {
      const gameId = normalizeGepGameId(reportedGameId);
      this.error(`GEP error for game ${gameId} (reported ID: ${reportedGameId}): ${error}`, ...args);
      if (gameId === kGepSupportedGameIds.TeamfightTactics) {
        void this._auditRecorder.recordError(gameId, error, args).catch(() => undefined);
      }
      this.emit('gep-error', { gameId, error, args });
    });

    this._gepApi.on('game-exit', (event, reportedGameId, name, pid) => {
      const gameId = normalizeGepGameId(reportedGameId);
      this.log(`Game exit: ${name} (reportedGameId: ${reportedGameId}, canonicalGepGameId: ${gameId}, pid: ${pid})`);
      if (gameId === kGepSupportedGameIds.TeamfightTactics) {
        void this._auditRecorder.recordLifecycle(gameId, 'game-exit', { name, pid });
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
