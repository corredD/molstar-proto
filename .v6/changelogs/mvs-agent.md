## prism-me: the assistant edits a MesoViewSpec document

- The assistant has a `mesoviewspec` skill: it opens, reads, edits, styles (color, visible, transparency, emissive),
  shows only, frames, lights and saves a document, and shows one of its views. Each turn it is told what is open: a line
  a compartment with its populations and their counts, the view shown and the issues. Looks and edits are one step for
  the turn, and Undo turn takes them back; they are saved with the document.
- It asks before it opens a document from a host it does not know, shows a view, saves or closes. Framing and lighting
  an address do not ask.
- For extensions: `ViewerExtension.agentState` (and the same on a lazy extension's stub) gives lines that follow the
  scene's outline in each agent turn. `mesoviewspec.focus` and `.highlight` are view changes (no history step) and no
  longer asked for by the agent.
