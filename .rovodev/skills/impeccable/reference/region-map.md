# Region map

A region map names what is actually visible in the approved comp before asset production. It is not a page build or an asset approval.

1. Run `.rovodev/skills/impeccable/scripts/impeccable comp-spec --comp <comp.png> --grid` and open the original and gridded images.
2. Run `.rovodev/skills/impeccable/scripts/impeccable comp-spec --schema` for the JSON fields. Write `regions.json` with a `regions` array. Each region needs a stable `id`, `kind`, `note`, and exactly one of `pixelBox`, normalized `box`, or `grid`. Use the original comp’s dimensions.
3. Run `.rovodev/skills/impeccable/scripts/impeccable comp-spec --comp <comp.png> --regions regions.json --inspect-map`. The output points to a report, overlay, exact crops and `COMPARE` sheets of masked references. The default prints findings; `--json` prints the entire report, with sheet paths in `comparisonSheets`.
4. Open the comparison sheets first to inspect affected crops together, then open individual crops where more detail is needed. Compare their bounds with the original. Inspect excluded foreground pixels as well as geometry errors. Every overlapping non-container code box is masked in full, including empty space inside it. Bound separate text elements separately so artwork in the gaps stays visible; a container describes their layout extent and never replaces its children. Correct the map and inspect again; use a new output directory each time. Zero errors does not certify crop accuracy. Coverage warnings are hints, not proof of completeness.

If the request ends at mapping, stop with the map, inspection report and unresolved findings. To continue a build, measure the inspected map with `comp-spec --comp <comp.png> --regions regions.json` and follow [new-work.md](new-work.md).

`--auto` produces horizontal band scaffolding, not element identification. It is optional and does not replace authoring a map.

## Containment and repetition

`parentId` identifies an enclosing `container: true` region. Parent and children keep separate IDs and crops. Containment never transfers approval.

`reviewGroup` identifies repeated instances of the same code component and role. Members must have the same kind and container status and be peers, not ancestors and children. Sharing a card or section is not a reason to group its different parts. Keep every instance in the map and component kit. Raster assets remain individually reviewable. Grouping does not waive crop checks or approve anything; applying a decision to peers remains the user’s choice.

Comp crops are reference evidence only, never production assets. The map inspector marks its PNGs as comp-derived.
