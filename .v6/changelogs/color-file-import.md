## prism-me: Mesoscale

- Entity colors from a JSON file: `mesoscale.importColors` (a command, the agent's `import_mesoscale_colors`, Import
  colors… in a model's Look) reads the Mesoscale Explorer's color file
  (`{"<compartment>.<entity>": {"x": r, "y": g, "z": b}}`, 0-255) or a plain `{"<entity>": "#rrggbb"}` map, colors
  every entity it names in one step, and says the names it did not find.
