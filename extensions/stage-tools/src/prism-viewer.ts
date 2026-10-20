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
  // The `stage` area: cuts on what the scene shows, their guides, and the canvas's menu.
  interface ExtensionApis {
    stage: StageApi;
  }
}

// The stage tools in the Prism viewer (apps/prism-me/_spec/features.md, "Stage tools"; Stories Untold's stage menu
// and cut guides): cuts (a plane, a sphere or a box) on a structure, a particle list or a volume, seen as translucent
// guides, adjusted in a Cut row; and the canvas's right-click menu on what was picked. A host that keeps the camera's
// right-click focus (Mol*'s default) gets both: prism-me drops it (its spec's `finalize`).

export const StageSkill: ViewerSkill = {
  id: 'stage',
  title: 'Cuts',
  summary: 'cut a structure, particle list or volume open with a plane, a sphere or a box; move, size, flip, remove it',
  guidance: [
    'Skill stage: cut_open cuts what is shown open: a plane through its center facing the camera (the near half',
    'cut away), or a sphere or a box, a window on its near side; one cut per object, a new one replaces the old.',
    'adjust_cut moves it along its normal (offset −1 to 1 of the radius), sizes a sphere or box (size, in radii) and',
    'flips it (a plane cuts the other side; a sphere or box keeps its inside). remove_cut removes it; get_cuts lists',
    'them; show_cuts shows or hides their translucent shapes. add_label puts plain text in front of an object',
    '(target: its state ref), change_label edits its text, size, color or place, hides or removes it.',
  ].join('\n'),
  tools: [
    { id: 'cut_open', operation: 'stage.cut', description: 'Cuts a structure, particle list or volume open.' },
    { id: 'adjust_cut', operation: 'stage.adjust', description: 'Moves, sizes or flips a cut.' },
    { id: 'remove_cut', operation: 'stage.uncut', description: 'Removes a cut.' },
    { id: 'get_cuts', operation: 'stage.cuts', description: 'Lists the cuts.' },
    { id: 'show_cuts', operation: 'stage.guides', description: 'Shows or hides the shapes of the cuts.' },
    { id: 'add_label', operation: 'stage.label', description: 'Adds a plain-text label in front of an object.' },
    { id: 'change_label', operation: 'stage.editLabel', description: 'Changes, hides or removes a label.' },
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
    const category = 'Cuts';
    return [
      operationCommand(api, s.cut, {
        category,
        icon: 'crop',
        alias: ['cut', 'clip', 'cut open', 'section', 'slice open'],
      }),
      operationCommand(api, s.adjust, {
        category,
        icon: 'sliders-horizontal',
        alias: ['move cut', 'flip cut', 'cut size'],
      }),
      operationCommand(api, s.uncut, { category, icon: 'x', alias: ['remove cut', 'uncut', 'remove clip'] }),
      operationCommand(api, s.guides, {
        category,
        icon: 'eye',
        alias: ['show cuts', 'hide cuts', 'cut guides'],
        action: 'Apply',
      }),
      operationCommand(api, s.cuts, { category, icon: 'info', alias: ['cuts', 'clips'] }),
      operationCommand(api, s.label, { category: 'Labels', icon: 'type', alias: ['label', 'add label', 'annotate'] }),
      operationCommand(api, s.editLabel, { category: 'Labels', icon: 'type', alias: ['edit label', 'remove label'] }),
    ];
  },
  skills: [StageSkill],
  ui: async (ctx) => (await import('./prism-viewer-ui.js')).stageToolsUI(ctx),
};
