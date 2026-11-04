## prism-me: entity descriptions

- A cellPACK entity's description (the Exosome's "Integrin alpha-5, important for cell adhesion and signaling.") shows
  under its name on hover, two lines at most (a Markdown link as its text), and under its name in its properties
  (Markdown, links open in a new tab), as the Mesoscale Explorer's hover box and Focus Info.
- `ParticleEntityInfo.description` (`@molstar/model`): the cellPACK mmCIF reader fills it from
  `_entity.pdbx_parent_entity_id` when that holds text, not the entity's compartment (MG, HIV) or its name;
  `function` keeps `_entity.details`. A single particle's loci label puts it under the particle.
