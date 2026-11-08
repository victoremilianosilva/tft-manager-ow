# Canonical TFT live-state contract

## Ownership

The Overwolf Electron application is the only layer that interprets GEP feature paths.
It merges GEP deltas, reconciles the baseline, filters private/combat data, converts
the strategic feature tree and publishes a canonical state. Python and C++ consume
this contract; neither is allowed to map GEP names such as `me.me.gold` or
`board.board_pieces.cell_1`.

## Envelope v2

- `schemaVersion: 2`
- `gameId`, `revision`, `capturedAt`, `complete`
- `state`: `contract: "tft.live-state"`, `contractVersion: 1`

Each scalar uses `{ known, value }`. Unknown is `{known:false,value:null}`;
known zero is `{known:true,value:0}`. Board, bench and shop expose a known flag
and fixed-size slots. A known empty slot has `known:true, unit:null`. Missing
source features remain unknown and are never synthesized.

## Canonical state

- Match ID is normalized to a string when GEP reports it; it scopes revisions across consecutive matches in one client process.
- Stage and round are numeric.
- Players are indexed by GEP roster index; names and account identifiers are not
  exported. `localPlayerIndex` is derived from `localplayer`.
- Local player fields include HP, gold, level, XP, board, bench, shop and component
  stacks (API name + count).
- Opponent data is limited to fields actually present in the roster. Their board,
  bench, shop and economy remain unknown.
- Unit positions are zero-based array positions derived from GEP `cell_N` keys.
  This mapping must be checked against the native board coordinate convention
  before enabling Engine observation generation.
- Equipped item IDs are attached to each unit; component quantities are preserved.
- Carousel data is advisory and does not become player inventory.

## Compatibility

Schema v1 carried raw `info` and is no longer accepted by the inference service.
The producer emits v2 canonical state only. The inference boundary validates
shape, version, revision, finite values and sensitive-key absence; it does not
interpret GEP paths.

## Known unavailable fields

The current GEP capture does not provide trustworthy current boards for all seven
opponents, opponent gold/level/shop, or persistent composition strategy state.
Those remain explicitly unknown. Historical `match_stats.board_players` must not
be substituted for current opponent boards.


## Offline dual JSONL audit (no network transport)

The Overwolf-to-Python HTTP bridge is disabled and removed. Overwolf does not
connect to Python, localhost, or any external inference endpoint.

Two independent JSONL files are written under the app's `userData/tft-snapshots`
directory:

- `tft-gep-raw-*.jsonl`: every raw TFT `new-info-update` and `new-game-event`
  payload received from GEP, plus lifecycle/error records.
- `tft-ia-payloads-*.jsonl`: every full canonical v2 envelope that would be
  supplied to IA, one payload per line (not deltas or deduplicated snapshots).

Both streams pass through the credential/privacy sanitizer. Tokens, credentials,
passwords, secrets, authorization values, PUUIDs and account identifiers are
removed. The files have independent write queues and can be compared by capture
time, game ID, session/revision and resulting state changes. No policy inference
or game action is executed in this capture-only phase.
