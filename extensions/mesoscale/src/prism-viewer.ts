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
    'function. get_mesoscale_entities lists them; style_mesoscale_entities shows, hides, colors, fades or lights',
    'entities picked by name or by group (reset brings them back); color_mesoscale_entities generates colors (a hue',
    'per group), one uniform color, or goes back to the color theme; set_mesoscale_graphics trades detail for speed.',
  ].join('\n'),
  tools: [
    {
      id: 'get_mesoscale_entities',
      operation: 'mesoscale.entities',
      description: "Lists a mesoscale model's entities, groups and their look.",
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
      id: 'set_mesoscale_graphics',
      operation: 'mesoscale.graphics',
      description: 'Sets the graphics mode: ultra, quality, balanced or performance.',
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
      operationCommand(api, m.graphics, {
        category,
        icon: 'gauge',
        alias: ['graphics mode', 'performance', 'quality', 'level of detail', 'lod'],
        action: 'Apply',
      }),
      operationCommand(api, m.entities, { category, icon: 'info', alias: ['mesoscale entities', 'compartments'] }),
    ];
  },
  skills: [MesoscaleSkill],
  ui: async (ctx) => (await import('./prism-viewer-ui.js')).mesoscaleUI(ctx),
};
