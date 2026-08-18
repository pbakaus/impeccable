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

`calls/` is generated (about 10 MB) and not committed while the JS engine is
still in the tree; regenerate with `node tests/oracle/vectors/record-calls.mjs`.
A frozen snapshot is committed when the JS engine is removed.
