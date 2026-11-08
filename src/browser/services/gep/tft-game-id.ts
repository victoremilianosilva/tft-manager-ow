import { kGepSupportedGameIds } from '@overwolf/ow-electron-packages-types/gep-supported-games';

/**
 * Overwolf exposes two different IDs for TFT:
 * - 28164: game-detected / game-list ID reported by the running client.
 * - 21570: canonical GEP ID required by getFeatures, setRequiredFeatures,
 *   getInfo and the TFT GEP payloads (per Overwolf's TFT GEP documentation).
 *
 * Keep the conversion at the event boundary so the capture service only ever
 * works with canonical GEP IDs.
 */
export const TFT_OVERWOLF_GAME_ID = 28164;
export const TFT_GEP_GAME_ID = kGepSupportedGameIds.TeamfightTactics;

export function normalizeGepGameId(gameId: number): number {
  return gameId === TFT_OVERWOLF_GAME_ID ? TFT_GEP_GAME_ID : gameId;
}
