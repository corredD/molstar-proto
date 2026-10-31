/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { operationCommand } from '@molstar/prism-viewer/commands/operations';
import type { ViewerExtension, ViewerSkill } from '@molstar/prism-viewer/spec';
import { MesoscaleApi } from './operations.js';

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
      operationCommand(api, m.example, {
        category,
        icon: 'folder-open',
        alias: ['example', 'mesoscale example', 'cellpack', 'petworld'],
      }),
      operationCommand(api, m.entities, { category, icon: 'info', alias: ['mesoscale entities', 'compartments'] }),
    ];
  },
  skills: [MesoscaleSkill],
  ui: async (ctx) => (await import('./prism-viewer-ui.js')).mesoscaleUI(ctx),
};
