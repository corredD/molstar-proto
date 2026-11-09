## MesoViewSpec patches

- Patches over a MesoViewSpec document: `applyPatch`, `diff`, `classifyPatch` and the S-expression spelling
  (`printPatch`, `readPatch`) in `@molstar/meso-spec/format/patch`: ops by id (`set`, `remove`, `insert`, `move`), all or
  nothing, the inverse returned, untouched sections shared
- A look has an optional `id` and an `emissive` (0-1), which reaches the Prism layer; a document has a `revision`
- The `Patches` story (MesoViewSpec) shows a look edit as a patch, its inverse, and undo by the inverse
