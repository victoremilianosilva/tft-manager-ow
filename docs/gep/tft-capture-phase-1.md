# TFT GEP capture — Phase 1

## Feature inventory

The official Overwolf TFT GEP catalog documents these feature groups:

| Feature | Relevant information | Capture decision |
| --- | --- | --- |
| `gep_internal` | Local/public GEP version and update status | Subscribe |
| `game_flow` | Lobby, matchmaking, loading, in-game and end-game phase | Subscribe |
| `game_info` | PBE flag, selected mode, queue status, client version | Subscribe |
| `end_game` | TFT end-of-game statistics | Subscribe |
| `me` | Player name, XP/level, health, rank and gold | Subscribe |
| `match_info` | Match/battle state, round, opponent, previous-round outcome, item selection and round events | Subscribe |
| `roster` | Players in the lobby/match and their public status | Subscribe |
| `store` | Shop pieces and shop visibility event | Subscribe |
| `board` | Own board pieces and opponent board pieces (when supported) | Subscribe |
| `bench` | Bench units and item bench (availability depends on GEP version) | Subscribe |
| `carousel` | Carousel units and their item components | Subscribe |
| `match_stats` | Historical board snapshots by stage (GEP 308+) | Subscribe |
| `live_client_data` | League live-client data model; not the source of TFT board/economy state | Do not subscribe initially |
| `augments` | Augment choices and selections | **Excluded** |
| `summoner_info`, `lcu_info`, `lobby_info` | Launcher/account/lobby context, depending on the published GEP catalog | Not needed for the in-match snapshot |

**Compliance constraint:** Overwolf's current TFT feature page explicitly warns third-party apps not to include or display augment data because of Riot's Terms of Service. The capture allowlist therefore excludes `augments`; do not add it without a fresh compliance review.

Feature availability is version-dependent. At runtime the service calls `getFeatures(gameId)` and subscribes only to the intersection of the allowlist and the installed provider's supported features. The actual enabled/unavailable lists are emitted as `tft-features-ready`.

## Snapshot semantics

- `new-info-update` is a delta, not a complete state.
- `getInfo()` provides the baseline/current stored game-info state.
- During initial reconciliation, incoming deltas are buffered; the baseline is applied first and buffered deltas are replayed afterward so newer values win.
- JSON-encoded GEP values are parsed when possible; unparseable strings remain strings.
- Each accepted update increments `revision` and refreshes `capturedAt`.
- `complete` becomes true only after the initial `getInfo()` reconciliation succeeds.
- Game exit clears the in-memory snapshot. A subsequent match must establish a new baseline.

## Local capture files

Snapshots are appended as JSON Lines under:

`<Electron userData>/tft-snapshots/tft-session-<timestamp>.jsonl`

One line is written per revision. These files are intended for local testing/replay and may contain player names and match state; do not commit real session captures to the repository or share them publicly without reviewing/redacting their contents.

## Phase 1 validation checklist

1. Run `yarn test:gep` to validate merge, revision, reset and reconciliation ordering.
2. Run the app with Overwolf and TFT open.
3. Confirm the log reports the enabled and unavailable feature lists; no `augments` feature should be enabled.
4. Confirm the JSONL file is created under the app's userData directory.
5. Compare the first complete snapshot with the live TFT state: gold, health, level/XP, stage/round, shop, board, bench, items, roster and carousel when visible.
6. Trigger purchases, XP, reroll, unit movement, item movement and round transitions. Confirm each revision preserves unchanged fields and updates only changed values.
7. Restart the app while a match is already running and verify that the baseline is reconstructed from `getInfo()`.
8. Treat unavailable or absent fields as unknown, not as zero/empty values.

## Known validation boundary

The feature inventory is based on Overwolf's published TFT GEP catalog. It is not proof that every field is currently emitted by the installed client/provider. Real-match captures are still required to establish field availability, update cadence, null/reset behavior and the exact `getInfo()` shape for the current TFT patch.
