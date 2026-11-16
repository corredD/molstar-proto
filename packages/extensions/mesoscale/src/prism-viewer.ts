/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { operationCommand } from '@molstar/prism-viewer/commands/operations';
import type { ViewerExtension, ViewerSkill } from '@molstar/prism-viewer/spec';
import { LipidMembrane } from './lipids/membrane.js';
import { MesoscaleApi } from './operations.js';
import { OrganelleMeshesProvider, OrganelleMeshFromBinary } from './organelle-meshes.js';
import { MesoscalePaintingList, ParticleListPainted } from './paint.js';

declare module '@molstar/prism-viewer/api' {
  // The `mesoscale` area: the Mesoscale Explorer's entity controls on particle lists.
  interface ExtensionApis {
    mesoscale: MesoscaleApi;
  }
}

// The Mesoscale Explorer's features in the Prism viewer (apps/prism-me/_spec/features.md, "Mesoscale"): cellPACK and
// PetWorld models load as particle lists (the plugin's `mmcif_particles`); this extension adds their entities and
// groups, each entity's look (visible, color, transparency, emissive), generated colors and the graphics modes, as
// operations with commands and tools, and the Entities tab (`prism-viewer-ui.tsx`, a chunk of its own).

export const MesoscaleSkill: ViewerSkill = {
  id: 'mesoscale',
  title: 'Mesoscale models',
  summary: "list a cellPACK or PetWorld model's entities and groups, show, hide and color them, set the graphics mode",
  guidance: [
    'Skill mesoscale: a cellPACK or PetWorld model (mmCIF, BinaryCIF) loads as a particle list: each entity (a',
    'molecule type) is instanced at many particles, entities are grouped by compartment (root.envelope.surface) or',
    'function. get_mesoscale_entities lists them (groupBy: compartment or function; absent: by compartment when the',
    'model has compartments); style_mesoscale_entities shows, hides, colors, fades or lights entities picked by name or',
    'by group (groupBy: the grouping the group is read in; reset brings them back); color_mesoscale_entities generates colors (a hue',
    'per group), one uniform color, or goes back to the color theme; color_objects_by_theme colors several objects at once by a theme; set_mesoscale_graphics trades detail for speed',
    '(object: one structure, model or volume alone; absent: every object and the canvas resolution);',
    "Their cuts are the clipping skill's (clipping.add with particles: a group's, an entity's or a target's).",
    'move_mesoscale_particles wiggles the atoms and tumbles the particles of one model (particles; empty: every one; 0 stops)',
    'or of one structure (object; a volume does not move); open_mesoscale_example opens one of',
    "the Mesoscale Explorer's examples by id (petworld-hiv, cellpack-hiv1, …).",
    'paint_mesoscale_copies paints copies of one entity at points (positions, and the surface normals there): one stroke a',
    'call, one undo step; no collision checks.',
  ].join('\n'),
  tools: [
    {
      id: 'get_mesoscale_entities',
      operation: 'mesoscale.entities',
      description: "Lists a mesoscale model's entities, their groups (by compartment or function) and their look.",
    },
    {
      id: 'style_mesoscale_entities',
      operation: 'mesoscale.style',
      description: 'Shows, hides, colors, fades or lights entities of a mesoscale model, by name or group.',
    },
    {
      id: 'color_mesoscale_entities',
      operation: 'mesoscale.colors',
      description: "Colors a mesoscale model's entities: generated per group, uniform, or the color theme.",
    },
    {
      id: 'import_mesoscale_colors',
      operation: 'mesoscale.importColors',
      description:
        "Colors a mesoscale model's entities from a JSON color file (by entity name), the Mesoscale Explorer's or a plain name-to-color map.",
    },
    {
      id: 'move_mesoscale_particles',
      operation: 'mesoscale.motion',
      description: 'Wiggles the atoms and tumbles the particles of a mesoscale model, or of one structure (object).',
    },
    {
      id: 'color_mesoscale_by_zoom',
      operation: 'mesoscale.colorLevels',
      description:
        'Colors a mesoscale model by the zoom: its compartments far away, its entities, chains and atoms (by element) closer; the edges in pixels an atom covers.',
    },
    {
      id: 'wrap_with_lipids',
      operation: 'mesoscale.wrapMembrane',
      description:
        'Wraps a mesh, a compartment (a sphere fitted to its particles) or a sphere with a lipid bilayer of matched tiles (WebGPU).',
    },
    {
      id: 'set_lipid_membrane_levels',
      operation: 'mesoscale.membraneDetail',
      description:
        "Sets a lipid membrane's levels of detail: a preset, or custom levels by distance from the camera (each its start in Å, stride and scale bias); a cut membrane's far look (spheres, texture or both), the pixel sizes it switches at and its lipids at most.",
    },
    {
      id: 'export_lipid_membrane',
      operation: 'mesoscale.exportMembrane',
      description:
        "Exports a cut lipid membrane's full build (every lipid of every triangle, its shown species) as a RELION STAR particle list.",
    },
    {
      id: 'set_lipid_membrane_species',
      operation: 'mesoscale.membraneSpecies',
      description: "Shows, hides or colors one species of a lipid membrane (its entities, as a particle system's).",
    },
    {
      id: 'draw_mesoscale_far_proteins',
      operation: 'mesoscale.impostors',
      description:
        "Draws a mesoscale model's far proteins as silhouettes (impostors: each copy its outline, flat, the default) or as spheres (on false); where they switch (by size on screen or distance), and the far ones thinned out (thin: below px, 0 off; thinScale: the kept ones enlarged, 0 to 1.5).",
    },
    {
      id: 'open_mesoscale_example',
      operation: 'mesoscale.example',
      description: "Opens one of the Mesoscale Explorer's examples by id.",
    },
    {
      id: 'color_objects_by_theme',
      operation: 'mesoscale.theme',
      description:
        'Colors several objects at once by a theme (by object, entity, chain, generated colors, one color, by zoom), each kind by what it takes: structures, particle models and lists, volumes (their isosurfaces), meshes.',
    },
    {
      id: 'paint_mesoscale_copies',
      operation: 'mesoscale.paint',
      description:
        'Paints copies of an entity at points of the scene (a stroke, one step): a membrane protein upright along the normals given, anything else turned at random.',
    },
    {
      id: 'group_mesoscale_instances',
      operation: 'mesoscale.group',
      description:
        "Makes a group of a list's instances (particles by index; a group copy's member stands for the copy): a brush of its own, painted and grown as one (mesoscale.paint group), one step.",
    },
    {
      id: 'ungroup_mesoscale_copy',
      operation: 'mesoscale.ungroup',
      description:
        'Ungroups a painted group copy (a particle of it by index): its members instances of their own, one step.',
    },
    {
      id: 'grow_mesoscale_copies',
      operation: 'mesoscale.grow',
      description:
        'Grows copies of a particle (its index in a list) by a rule, one step: a random walk (a new fiber), a crystal lattice, a planar tiling or a sphere of copies about it; overlaps allowed.',
    },
    {
      id: 'set_mesoscale_graphics',
      operation: 'mesoscale.graphics',
      description:
        'Sets the graphics mode (ultra, quality, balanced or performance) of one object (a structure, a model, a volume) or of every object.',
    },
  ],
};

export const MesoscaleExtension: ViewerExtension = {
  id: 'mesoscale',
  title: 'Mesoscale',
  api: { mesoscale: (ctx) => new MesoscaleApi(ctx) },
  // the lipid membrane's transform, in saved states and history (`lipids/membrane.ts`); the yeast cell viewer's organelle
  // meshes through + Open (`organelle-meshes.ts`); its painted strokes, so a session that has them opens
  plugin: {
    registry: [
      {
        actions: [LipidMembrane, OrganelleMeshFromBinary, ParticleListPainted, MesoscalePaintingList],
        formats: [OrganelleMeshesProvider],
      },
    ],
  },
  commands: (api) => {
    const m = api.mesoscale;
    if (!m) return [];
    const category = 'Mesoscale';
    return [
      operationCommand(api, m.style, {
        category,
        icon: 'eye',
        alias: ['entity', 'hide entity', 'show entity', 'compartment', 'cellpack', 'petworld'],
        action: 'Apply',
      }),
      operationCommand(api, m.colors, {
        category,
        icon: 'palette',
        alias: ['color entities', 'generate colors', 'mesoscale colors'],
        action: 'Apply',
      }),
      operationCommand(api, m.importColors, {
        category,
        icon: 'upload',
        alias: ['import colors', 'color file', 'load colors', 'colors json'],
        action: 'Import',
      }),
      operationCommand(api, m.graphics, {
        category,
        icon: 'gauge',
        alias: ['graphics mode', 'performance', 'quality', 'level of detail', 'lod'],
        action: 'Apply',
      }),
      operationCommand(api, m.motion, {
        category,
        icon: 'sparkles',
        alias: ['wiggle', 'tumble', 'procedural animation', 'motion'],
        action: 'Apply',
      }),
      operationCommand(api, m.colorLevels, {
        category,
        icon: 'palette',
        alias: ['color levels', 'colors by zoom', 'dynamic coloring', 'chameleon'],
        action: 'Apply',
      }),
      operationCommand(api, m.impostors, {
        category,
        icon: 'gauge',
        alias: ['far proteins', 'silhouettes', 'impostors', 'level of detail', 'lod'],
        action: 'Apply',
      }),
      operationCommand(api, m.fiber, {
        category,
        icon: 'sliders-horizontal',
        alias: ['fiber', 'fibre', 'fiber rise', 'fiber twist', 'dna twist', 'rna', 'helix rise'],
        action: 'Apply',
      }),
      operationCommand(api, m.example, {
        category,
        icon: 'folder-open',
        alias: ['example', 'mesoscale example', 'cellpack', 'petworld'],
      }),
      operationCommand(api, m.paint, {
        category,
        icon: 'paintbrush',
        alias: ['paint', 'cellpaint', 'paint copies', 'brush'],
        action: 'Paint',
      }),
      operationCommand(api, m.group, {
        category,
        icon: 'paintbrush',
        alias: ['group', 'make group', 'cellpaint group', 'ultrastructure'],
        action: 'Group',
      }),
      operationCommand(api, m.ungroup, {
        category,
        icon: 'paintbrush',
        alias: ['ungroup', 'ungroup copy'],
        action: 'Ungroup',
      }),
      operationCommand(api, m.grow, {
        category,
        icon: 'paintbrush',
        alias: ['grow', 'crystal', 'lattice', 'tiling', 'random walk', 'helix', 'spiral', 'grow copies'],
        action: 'Grow',
      }),
      operationCommand(api, m.clearGrown, {
        category,
        icon: 'trash-2',
        alias: ['clear grow', 'clear grown', 'remove grown copies'],
        action: 'Clear',
      }),
      operationCommand(api, m.grownFiber, {
        category,
        icon: 'sliders-horizontal',
        alias: ['grown fiber', 'walk rise', 'walk twist'],
        action: 'Apply',
      }),
      operationCommand(api, m.entities, { category, icon: 'info', alias: ['mesoscale entities', 'compartments'] }),
      operationCommand(api, m.wrapMembrane, {
        category,
        icon: 'layers',
        alias: ['lipids', 'membrane', 'wrap with lipids', 'bilayer', 'lipid wrapper'],
        action: 'Wrap',
      }),
      operationCommand(api, m.membraneDetail, {
        category,
        icon: 'layers',
        alias: ['membrane levels', 'lipid lod', 'membrane detail', 'levels of detail', 'far look'],
        action: 'Apply',
      }),
      operationCommand(api, m.exportMembrane, {
        category,
        icon: 'download',
        alias: ['export lipids', 'membrane star', 'full build'],
        action: 'Export',
      }),
      operationCommand(api, m.membraneSpecies, {
        category,
        icon: 'eye',
        alias: ['lipid species', 'membrane species', 'hide lipids'],
        action: 'Apply',
      }),
    ];
  },
  skills: [MesoscaleSkill],
  ui: async (ctx) => (await import('./prism-viewer-ui.js')).mesoscaleUI(ctx),
};
