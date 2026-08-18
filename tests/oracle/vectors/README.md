# Function-level vectors

`record-calls.mjs` runs the detect CLI and the pure-function unit tests with a
loader hook (`hooks.mjs` / `hooks-impl.mjs`) that routes every exported
function declaration in the pure engine modules through `recorder.mjs`. Each
call whose arguments and result are plain data is written once (deduplicated by
arguments) to `calls/<module>/<fn>.jsonl` as `{ "args": [...], "result": ... }`.

Encoding of values JSON cannot carry: `{"$undef":true}`, `{"$nan":true}`,
`{"$inf":1|-1}`, `{"$negzero":true}`, `{"$map":[[k,v],...]}`, `{"$set":[...]}`.

`calls/_skipped.json` names the functions whose calls held DOM-ish objects or
closures; those are covered end to end by the `detect` goldens instead.

`calls/` (about 10 MB) is the frozen snapshot recorded from the JS engine
right before it left the tree with the launcher swap. It can never be
regenerated: the modules `record-calls.mjs`, `hooks.mjs`, `hooks-impl.mjs`,
and `recorder.mjs` instrumented no longer exist here, and those scripts stay
only as the historical record of how the vectors were produced. Treat the
directory as read-only test data for the engine's rule-level parity checks.
