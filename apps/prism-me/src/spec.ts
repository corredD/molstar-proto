/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Binding } from '@molstar/core/util/binding';
import { ButtonsType, ModifiersKeys } from '@molstar/core/util/input/input-observer';
import { FocusLoci as CameraFocusLoci } from '@molstar/plugin/behavior/dynamic/camera';
import { DefaultSelectLociBindings, SelectLoci } from '@molstar/plugin/behavior/dynamic/representation';
import { PluginConfig } from '@molstar/plugin/config';
import { PluginSpec } from '@molstar/plugin/spec';
import { PLUGIN_VERSION } from '@molstar/plugin/version';
import { assistant } from '@molstar/prism-assistant/spec';
import { Skills } from '@molstar/prism-viewer/agent/skills';
import { webStore } from '@molstar/prism-viewer/persist/stores';
import type { PrismViewerSpec } from '@molstar/prism-viewer/spec';
import { FullPrismViewerSpec } from '@molstar/prism-viewer-app/full-spec';
import { optionsFromUrl } from '@molstar/prism-viewer-app/url';
import { StageSkill } from '@molstar/stage-tools-extension/prism-viewer';
import { MesoscaleExplorerExtensions } from './extensions.js';
import { withZoomColorsAtLoad } from './formats.js';
import { withMesoscaleLook } from './look.js';
import { withTomogramSlices } from './tomograms.js';

/**
 * The spec of the Mesoscale Explorer (viewer-spec.md §5): the Prism viewer with Mol*'s extensions, the explorer's
 * extensions, its look (a dark canvas, as v5's explorer) and the URL's options. `search` is the loaders' query string
 * (`toLoaderSearch`).
 */
export function createMesoscaleExplorerSpec(search: string): PrismViewerSpec {
  const base = FullPrismViewerSpec();
  const options = optionsFromUrl(search);
  const baseAgent = base.agent || {};
  return {
    ...base,
    // A particle list with orientations opens as its spheres and its axes (Ludovic, 2026-10-22)
    plugin: {
      ...base.plugin,
      config: [...(base.plugin.config ?? []), [PluginConfig.Particles.ShowOrientations, true]],
    },
    // cellPACK and PetWorld open with colors that follow the zoom (_spec/ui.md §4 Look; Ludo, 2026-11-04)
    extensions: [...withZoomColorsAtLoad(base.extensions ?? []), ...MesoscaleExplorerExtensions],
    // One panel (_spec/ui.md §1): the explorer's tree and properties; the others stay reachable from ⌘K
    overrides: { ...base.overrides, ...Object.fromEntries(HiddenParts.map((id) => [id, null])) },
    options: {
      ...options,
      canvas: { background: '#101010', ...options.canvas },
      // Not now (_spec/ui.md §6): the sequence band (its API stays)
      ui: { homeWhenEmpty: false, showSequence: false, showRemoteStates: true, ...options.ui },
    },
    ui: {
      ...base.ui,
      theme: base.ui?.theme ?? 'dark',
      // The panels stay open beside the canvas: their sliders (cuts, slices, motion) are used while watching the scene
      layout: {
        ...base.ui?.layout,
        docks: { ...base.ui?.layout?.docks, right: { ...base.ui?.layout?.docks?.right, pinned: true } },
      },
    },
    persist: {
      key: 'prism-me',
      preferences: webStore('local', { prefix: 'prism-me', version: PLUGIN_VERSION, budget: 64 * 1024 }),
    },
    agent: {
      ...baseAgent,
      // The stage tools' labels and measurements (atoms, particles, a mesh's triangle) take the place of Prism's
      // Measurements tools of the same names (a toolkit refuses a name given twice); its list and remove stay
      skills: { ...baseAgent.skills, add: [...(baseAgent.skills?.add ?? []), ...withoutStageTools(Skills)] },
      assistant: assistant(),
    },
    finalize: (spec) =>
      withTomogramSlices(
        withMesoscaleLook(withModifierSelect(withoutRightClickFocus(base.finalize ? base.finalize(spec) : spec))),
      ),
  };
}

/**
 * Prism's skills that name a tool of the stage tools (Measurements: add_label, measure_distance, measure_angle,
 * measure_dihedral), each with those tools left out: added by the same id, it takes the default's place
 */
export function withoutStageTools(skills: typeof Skills): typeof Skills {
  const stage = new Set(StageSkill.tools.map((t) => t.id));
  return skills
    .filter((s) => s.tools.some((t) => stage.has(t.id)))
    .map((s) => ({ ...s, tools: s.tools.filter((t) => !stage.has(t.id)) }));
}

/** The parts the explorer's panel replaces (_spec/ui.md §1): their operations stay, for ⌘K and the assistant */
export const HiddenParts = [
  'core.tab.home',
  'core.tab.structure',
  'core.tab.selection',
  'core.tab.history',
  'core.tab.help',
  'snapshots.tab.snapshots',
  'state-tree.tab.tree',
  'mesoscale.tab.entities',
  'cryoet.tab.segmentations',
  'animation.toolbar.animation',
  'core.toolbar.export',
];

const B = ButtonsType;
const M = ModifiersKeys;

/**
 * The camera's focus on click without its right-button triggers: the right button opens the stage's menu (the
 * stage-tools extension), whose Focus item does what the right-click did.
 */
const LeftClickFocusBindings = {
  clickCenterFocus: Binding(
    [
      Binding.Trigger(B.Flag.Primary, M.create()),
      Binding.Trigger(B.Flag.Primary, M.create({ control: true })),
      Binding.Trigger(B.Flag.Trigger),
    ],
    'Camera center and focus',
    'Click element using ${triggers}',
  ),
  clickCenterFocusSelectMode: Binding(
    [Binding.Trigger(B.Flag.Primary, M.create({ control: true }))],
    'Camera center and focus (Selection Mode)',
    'Click element using ${triggers}',
  ),
  clickResetCameraOnEmpty: Binding(
    [
      Binding.Trigger(B.Flag.Primary, M.create()),
      Binding.Trigger(B.Flag.Primary, M.create({ control: true })),
      Binding.Trigger(B.Flag.Trigger),
    ],
    'Reset camera focus',
    'Click on nothing using ${triggers}',
  ),
  clickResetCameraOnEmptySelectMode: Binding(
    [Binding.Trigger(B.Flag.Primary, M.create({ control: true }))],
    'Reset camera focus (Selection Mode)',
    'Click on nothing using ${triggers}',
  ),
};

function withoutRightClickFocus(spec: PluginSpec): PluginSpec {
  return {
    ...spec,
    behaviors: spec.behaviors.map((b) =>
      b.transformer === CameraFocusLoci
        ? PluginSpec.Behavior(CameraFocusLoci, { ...b.defaultParams, bindings: LeftClickFocusBindings })
        : b,
    ),
  };
}

/**
 * Selection mode's click toggle also on ⌘+click and Ctrl+click (Ludovic, 2026-10-25): those clicks pick a distance's
 * points there (_spec/ui.md §7), and select as a plain click does; the distance is added, the selection not replaced.
 */
function withModifierSelect(spec: PluginSpec): PluginSpec {
  return {
    ...spec,
    behaviors: spec.behaviors.map((b) => {
      if (b.transformer !== SelectLoci) return b;
      const params = (b.defaultParams ?? {}) as { bindings?: typeof DefaultSelectLociBindings };
      const bindings = params.bindings ?? DefaultSelectLociBindings;
      const clickToggle = Binding(
        [
          ...bindings.clickToggle.triggers,
          Binding.Trigger(B.Flag.Primary, M.create({ control: true })),
          Binding.Trigger(B.Flag.Primary, M.create({ meta: true })),
        ],
        bindings.clickToggle.action,
        bindings.clickToggle.description,
      );
      return PluginSpec.Behavior(SelectLoci, { ...params, bindings: { ...bindings, clickToggle } });
    }),
  };
}
