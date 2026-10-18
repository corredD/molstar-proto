/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { operationCommand } from '@molstar/prism-viewer/commands/operations';
import type { ViewerExtension, ViewerSkill } from '@molstar/prism-viewer/spec';
import { CryoetApi } from './operations.js';

declare module '@molstar/prism-viewer/api' {
  // The `cryoet` area: what decorates particle lists, their targets by class, the slices of tomograms.
  interface ExtensionApis {
    cryoet: CryoetApi;
  }
}

// Cryo-ET in the Prism viewer (apps/prism-me/_spec/features.md, "CryoET"): particle lists (RELION STAR, Dynamo TBL,
// Artiatomi EM, CryoET Data Portal NDJSON) decorated with objects, quickly swapped (an object of the scene is instant);
// their targets by class; tomograms and tilt series as gray slices. Operations with commands and tools, and rows in
// the scene tree (`prism-viewer-ui.tsx`, a chunk of its own): Decorations under a particle list, Slice under a volume.

export const CryoetSkill: ViewerSkill = {
  id: 'cryoet',
  title: 'Cryo-ET',
  summary: 'decorate particle lists with structures, shapes or volumes, by class; slice tomograms and tilt series',
  guidance: [
    'Skill cryoet: a particle list (RELION .star, Dynamo .tbl, Artiatomi .em, CryoET Data Portal .ndjson) has targets;',
    'every particle of a target is drawn as the object that decorates it. get_decorations lists the targets and what',
    'decorates each; decorate_particles sets it: with object (a structure, shape or volume already in the scene, by',
    'label: instant to swap), with pdb (a PDB id or a URL) or with none (spheres), for some targets or all;',
    'targets_by_class gives each class (or another attribute: cc, score) its own target, to decorate classes apart.',
    'slice_tomogram shows a gray slice of a tomogram or tilt series (axis z steps through its images; contrast in σ).',
    'get_meshes lists the segmentation meshes (OBJ, PLY, VTP); style_mesh shows, hides, fades or colors one and draws',
    'it as a surface, a wireframe or both.',
  ].join('\n'),
  tools: [
    {
      id: 'get_decorations',
      operation: 'cryoet.decorations',
      description: "Lists a particle list's targets and what decorates them.",
    },
    {
      id: 'decorate_particles',
      operation: 'cryoet.decorate',
      description: 'Decorates particles with an object of the scene, a PDB id or URL, or nothing.',
    },
    {
      id: 'targets_by_class',
      operation: 'cryoet.classes',
      description: 'Gives each class (or value of an attribute) of a particle list its own target.',
    },
    {
      id: 'slice_tomogram',
      operation: 'cryoet.slice',
      description: 'Shows a gray slice of a tomogram or tilt series.',
    },
  ],
};

export const CryoetExtension: ViewerExtension = {
  id: 'cryoet',
  title: 'Cryo-ET',
  api: { cryoet: (ctx) => new CryoetApi(ctx) },
  commands: (api) => {
    const c = api.cryoet;
    if (!c) return [];
    const category = 'Cryo-ET';
    return [
      operationCommand(api, c.decorate, {
        category,
        icon: 'shapes',
        alias: ['decorate', 'instance', 'particles with', 'subtomogram average', 'particle object'],
      }),
      operationCommand(api, c.classes, { category, icon: 'layers', alias: ['class', 'classes', 'rlnClassNumber'] }),
      operationCommand(api, c.slice, {
        category,
        icon: 'scan',
        alias: ['tomogram', 'tilt series', 'slice', 'section', 'mrc slice'],
      }),
      operationCommand(api, c.mesh, {
        category,
        icon: 'box',
        alias: ['segmentation', 'mesh', 'wireframe', 'obj', 'vtp', 'ply'],
        action: 'Apply',
      }),
      operationCommand(api, c.decorations, { category, icon: 'info', alias: ['decorations', 'targets'] }),
    ];
  },
  skills: [CryoetSkill],
  ui: async (ctx) => (await import('./prism-viewer-ui.js')).cryoetUI(ctx),
};
