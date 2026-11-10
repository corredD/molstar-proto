## prism-me: Mesoscale

- Fix the colors by zoom doing nothing since the master merge: mmCIF particle targets are sites now (`ParticleSites`,
  not a structure), and the color levels were only made for structure targets. A sites target's near colors are its
  sites' elements (`ParticleSites.elements`, read from `_atom_site.type_symbol`; a carbon's without) and its chains'
  offsets; By zoom is on at load again and Off / On toggle it.
