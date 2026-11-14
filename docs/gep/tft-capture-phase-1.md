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
| `live_client_data` | League live-client data model; not the source of TFT board/economy state | Do not subscribe |
| `augments` | Augment choices and selections | **Excluded** |
| `summoner_info`, `lcu_info`, `lobby_info` | Launcher/account/lobby context, depending on the published GEP catalog | Not needed for the in-match snapshot |

**Compliance constraint:** Overwolf's TFT feature guidance warns third-party apps not to include or display augment data. The active allowlist in `GameEventsService.TFT_REQUIRED_FEATURES` excludes `augments`; do not add it without a fresh compliance review.

Feature availability is version-dependent. At runtime the service calls `getFeatures(gameId)` and subscribes only to the intersection of the allowlist and the installed provider's supported features. The actual enabled/unavailable lists are emitted as `tft-features-ready`.

## Snapshot semantics

- `new-info-update` is a delta, not a complete state.
- `getInfo()` provides the baseline/current stored game-info state.
- During initial reconciliation, incoming deltas are buffered; the baseline is applied first and buffered deltas are replayed afterward so newer values win.
- JSON-encoded GEP values are parsed when possible; unparseable strings remain strings.
- Each accepted state change increments `revision` and refreshes `capturedAt`.
- `complete` becomes true only after the initial `getInfo()` reconciliation succeeds.
- Game exit clears the in-memory snapshot. A subsequent match must establish a new baseline.
- The mapper emits `tft.live-state` contract version 1 inside transport schema version 2. Unknown values remain explicit; known-empty slots are distinct from unknown slots.

## Active local audit files

The active `GameEventsController` uses `TftDualAuditRecorder`. It writes two independent JSONL streams under:

`<Electron userData>/tft-snapshots/`

- `tft-gep-raw-<session>.jsonl`: sanitized raw `new-info-update` and `new-game-event` payloads, `getInfo()` baseline/reconciliation records, lifecycle events and capture errors.
- `tft-ia-payloads-<session>.jsonl`: each full canonical schema-v2 envelope emitted by the snapshot manager, including its revision and completeness state.

The raw stream is event-oriented; the canonical stream stores full envelopes, not only deltas. The queues are independent. These files are offline audit artifacts only: the active Overwolf controller does not send snapshots to Python, localhost, or an external inference endpoint.

**Privacy limitation:** `sanitizeTftPayload` removes credentials, tokens, passwords, authorization material, PUUIDs and several account-ID fields, and redacts augment payloads. It does not currently redact `summoner_name` or every player-name field from raw GEP payloads. Treat the raw JSONL as potentially identifying data: do not commit it or share it publicly. The canonical `tft.live-state` projection omits player names and account identifiers, but this does not make the raw stream anonymous.

A legacy `TftSnapshotRecorder` implementation for a single snapshot/delta JSONL remains in the recorder source file; the active controller imports and instantiates `TftDualAuditRecorder`. Do not use the legacy filename/record format to describe the active capture path.

## Phase 1 validation checklist

1. Run `yarn test:gep` to validate merge, revision, reset and reconciliation ordering.
2. Run the app with Overwolf and TFT open.
3. Confirm the log reports the enabled and unavailable feature lists; no `augments` feature should be enabled.
4. Confirm both JSONL files are created under the app's userData directory.
5. Compare the first complete canonical snapshot with the live TFT state: gold, health, level/XP, stage/round, shop, board, bench, items, roster and carousel when visible.
6. Trigger purchases, XP, reroll, unit movement, item movement and round transitions. Confirm the canonical stream records the resulting revisions.
7. Restart the app while a match is already running and verify that the baseline is reconstructed from `getInfo()`.
8. Treat unavailable or absent fields as unknown, not as zero/empty values.
9. Inspect raw audit files locally for player names before any controlled sharing; credentials/account IDs must remain absent.
10. Do not interpret successful capture or JSONL persistence as proof of Python transport, native Engine import, PPO inference or a live recommendation.

## Known validation boundary

The feature inventory is based on Overwolf's published TFT GEP catalog. It is not proof that every field is currently emitted by the installed client/provider. Real-match captures are still required to establish field availability, update cadence, null/reset behavior, exact `getInfo()` shape, and the GEP cell-coordinate convention for the current TFT patch. The canonical-to-native importer and end-to-end live inference path are not established by this capture phase.
