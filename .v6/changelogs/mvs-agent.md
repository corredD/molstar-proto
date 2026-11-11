## prism-me: the assistant edits a MesoViewSpec document

- The assistant has a `mesoviewspec` skill: it opens, reads, edits, styles (color, visible, transparency, emissive),
  shows only, frames, lights and saves a document, and shows one of its views. Each turn it is told what is open: a line
  a compartment with its populations and their counts, the view shown and the issues (at most 24 lines, 800 characters
  a line, 4000 in all). Looks, edits and showing a view are steps of the turn, and Undo turn takes them back; looks and
  edits are saved with the document.
- It asks before it reaches a host it does not know: a document's address, the resources of a document given as data
  (however their uris are written), the resources of a document opened by URL (from a known service such as zenodo
  too: the open names them, and the person is asked), and the resource uris an edit writes. It asks before it saves or
  closes. Framing, lighting and showing a view do not ask.
- The document's own text (titles, labels, an id that is not one, issue messages) is quoted in what the assistant reads.
- Showing a view (`mesoviewspec.view`) is a History step: Undo shows the view before again. A tour's views are no
  steps (`mesoviewspec.tour.view`).
- For extensions: `ViewerExtension.agentState` (and the same on a lazy extension's stub) gives lines that follow the
  scene's outline in each agent turn. `mesoviewspec.focus` and `.highlight` are view changes (no history step) and no
  longer asked for by the agent.
