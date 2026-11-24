# TFT GEP observational replay capture

The TFT GEP collector emits one hash-chained JSONL capture per detected TFT game session.

## Data path

1. GameEventsController receives GEP lifecycle, info-update and game-event callbacks.
2. GameEventsService builds canonical state snapshots from the supported public GEP features.
3. TftDualAuditRecorder persists sanitized raw events and canonical state snapshots in one ordered capture stream. Legacy raw/canonical audit files remain available.
4. game-exit closes the capture with a terminal footer. Application shutdown closes any still-active capture as incomplete.
5. The AI repository ingests the file, validates its chain and creates immutable per-match artifacts/datasets.

The canonical state manager uses the provider baseline plus buffered deltas. Snapshot revision, game-session ID and provider match ID are preserved independently from the application capture-session ID.

## Privacy and provider boundary

The capture removes credentials, account identifiers, PUUIDs, summoner display names and roster-name keys. Augments remain redacted. Battle/combat/damage fields are excluded, and the required GEP feature list does not request battle/combat telemetry.

The capture is therefore an observational state/event stream. It is not a deterministic replay, does not contain a verified action-execution trace and does not expose per-combat damage. A change in HP between two snapshots must not be interpreted as damage from one particular combat.

## Integrity

Each JSONL record contains:
- monotonically increasing sequence;
- record type and payload;
- previous record SHA-256;
- record SHA-256 over the exact serialized body.

The terminal footer declares whether the game session ended normally and whether capture errors occurred. A missing footer, provider/capture error, sequence gap or hash mismatch makes the artifact ineligible for dataset ingestion.

The replay file path is logged as “TFT GEP replay capture JSONL” when the game is detected. It is written under the app userData/tft-snapshots directory.
