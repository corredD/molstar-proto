## prism-me: the MesoViewSpec document in the Scene tree

- The open document is one item of Particles, named by its title, its count the copies drawn; under it its
  compartments (nested by `parent`), populations ("354 of 506" in the warning tone when short) and instances, and a
  superstructure population's parts, made when first opened. Group by (the document row's properties): Compartment,
  Model, Kind. Its lists are no longer rows of their own.
- A row stands for its MesoQL address: hover lights its copies over every list, a click picks it, a double click frames
  them (`mesoviewspec.focus`, the semantic camera's `lociSphere`), a click in 3D picks the copy's row (an expanded
  granule's copy: its part row). The hover label names the copy (`p.lipids#12`, `p.granules#3/p.Vamp2#40`, an instance
  by its id), then its entity and compartment.
- The eye and Show only on a document row are look patches on the shown view (`l.eye.<n>`, `l.only.<n>`), one step,
  saved in the document (`mesoviewspec.eye`, `mesoviewspec.showOnly`). Properties: Evidence, Built by, Issues.
- MesoViewSpec runtime: a look hiding an instanced type (a population drawn as parts) hides its parts too.
