## MesoViewSpec examples' resources resolve from the document

- `@molstar/meso-spec`: a relative resource `uri` resolves against the document's own location (format.md). The committed
  exosome and beta-cell examples name their recipes as `../spec/src/examples/fixtures/...`, so
  `?mesoviewspec=/packages/mesoscale/examples/exosome.mesoviewspec.json` draws whole in prism-me. `meso-compile` and
  `meso-query` read a relative uri from the document's folder (no `--base spec/src` needed); `--base dir` stays, as an
  override tried first; the working-directory fallback is gone.
