/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { operationCommand } from '@molstar/prism-viewer/commands/operations';
import type { ViewerExtension, ViewerSkill } from '@molstar/prism-viewer/spec';
import { StageLabel } from './label.js';
import { StageApi } from './operations.js';

declare module '@molstar/prism-viewer/api' {
  // The `stage` area: the canvas's menu, labels, objects moved by hand.
  interface ExtensionApis {
    stage: StageApi;
  }
}

// The stage tools in the Prism viewer (apps/prism-me/_spec/features.md, "Stage tools"; Stories Untold's stage menu):
// the canvas's right-click menu on what was picked, labels and moves (cuts are Prism's clipping). A host that keeps the
// camera's right-click focus (Mol*'s default) gets both: prism-me drops it (its spec's `finalize`).

export const StageSkill: ViewerSkill = {
  id: 'stage',
  title: 'Labels and moves',
  summary: 'put plain-text labels in the scene, move objects',
  guidance: [
    'Skill stage: add_label puts plain text in front of an object (target: its state ref), change_label edits its',
    'text, size, color, plate or tether, moves, hides or removes it. move_object moves or turns a structure, particle',
    'list, volume or mesh by a matrix, after where it is. scale_particles sets the Å per unit of a particle list (its',
    "positions in a tomogram's pixels: the pixel size). Cuts are the clipping skill's.",
  ].join('\n'),
  tools: [
    { id: 'add_label', operation: 'stage.label', description: 'Adds a plain-text label in front of an object.' },
    { id: 'change_label', operation: 'stage.editLabel', description: 'Changes, hides or removes a label.' },
    { id: 'move_object', operation: 'stage.move', description: 'Moves or turns an object by a matrix.' },
    {
      id: 'scale_particles',
      operation: 'stage.scale',
      description: "Scales a particle list's positions: Å per unit of its file (a tomogram's pixel size).",
    },
  ],
};

export const StageToolsExtension: ViewerExtension = {
  id: 'stage-tools',
  title: 'Stage tools',
  // its labels are state transforms: registered, so a session that has them opens
  plugin: { registry: [{ actions: [StageLabel] }] },
  api: { stage: (ctx) => new StageApi(ctx) },
  commands: (api) => {
    const s = api.stage;
    if (!s) return [];
    return [
      operationCommand(api, s.label, { category: 'Labels', icon: 'type', alias: ['label', 'add label', 'annotate'] }),
      operationCommand(api, s.editLabel, { category: 'Labels', icon: 'type', alias: ['edit label', 'remove label'] }),
    ];
  },
  skills: [StageSkill],
  ui: async (ctx) => (await import('./prism-viewer-ui.js')).stageToolsUI(ctx),
};
