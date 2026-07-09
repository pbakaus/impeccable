# Design Context Categorization

Analysis of what `/impeccable init` + `/impeccable document` currently produce (`PRODUCT.md`, `DESIGN.md`, `.impeccable/design.json`) against a proposed 8-category **design context doc**: Audience, Product, Brand, Color, Typography, Iconography, Material, Interface.

Source examples analyzed (local scratch runs, not tracked in this repo):

- `tmp/notes/init-tests/runs/noren-ops-20260708-1832/DESIGN.md` + `proof/PRODUCT.md` + `proof/design.json`
- `tmp/notes/init-tests/runs/hanazono-atelier-20260708-1832/DESIGN.md` + `/Users/abdulwahab/hanazono-atelier/PRODUCT.md`

## Documents

- [`CONTENTS.md`](./CONTENTS.md) — what maps where, per category, with gaps and rationale.
- [`CONTENTS-TABLE.md`](./CONTENTS-TABLE.md) — the same mapping as lean per-category Value / Derived from / Source tables, no prose.
- [`MISSING.md`](./MISSING.md) — content gaps neither example run produces, regardless of category.
- [`ORPHANS.md`](./ORPHANS.md) — fields that exist today but don't have a clean home in the 8-category schema, plus open questions.
- [`PROVENANCE.md`](./PROVENANCE.md) — how the new visual document seed marks which fields are user-answered (resettable) vs. derived from code, and where that's stored.
