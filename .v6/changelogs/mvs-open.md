## prism-me: MesoViewSpec documents open

- A MesoViewSpec document opens in prism-me: dropped (with its resource files), from + Open › Files…, or by
  `?mesoviewspec=<url>`. The `mesoviewspec` lazy extension (`@molstar/meso-molstar/prism-viewer`) brings
  `mesoviewspec.open`, `.close`, `.get`, `.edit` (a patch, S-expression or JSON) and `.save`; nothing of it loads at
  start. Undo, Redo and a failed step's rollback restore the document with its lists, a re-pack included; a `.molj`
  holds it.
- Prism: a lazy stub's `owns.opens` routes a dropped document to its extension's operation instead of the format
  readers (`load.files`); the files dropped with it are handed to it as its resources.
