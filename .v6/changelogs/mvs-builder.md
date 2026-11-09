## MesoViewSpec builder

- A typed builder for MesoViewSpec documents, `createMesoDocument` and `q` in `@molstar/meso-spec/builder/index`: a node
  call returns a ref (an id branded by kind and scope), so a wrong reference is a TypeScript error; ids nobody gave are
  made from labels; `q.*` builds MesoQL addresses from refs; `build()` returns the document and `validate`'s issues
- The exosome, gallery, yeast, β-cell and nucleoid examples are written with it; their documents are unchanged
