/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Binding } from '@molstar/core/util/binding';
import { ButtonsType, ModifiersKeys } from '@molstar/core/util/input/input-observer';
import { FocusLoci as CameraFocusLoci } from '@molstar/plugin/behavior/dynamic/camera';
import {
  DefaultFocusLociBindings,
  FocusLoci as RepresentationFocusLoci,
} from '@molstar/plugin/behavior/dynamic/representation';
import { PluginConfig } from '@molstar/plugin/config';
import { PluginSpec } from '@molstar/plugin/spec';
import { PLUGIN_VERSION } from '@molstar/plugin/version';
import { assistant } from '@molstar/prism-assistant/spec';
import { webStore } from '@molstar/prism-viewer/persist/stores';
import type { PrismViewerSpec } from '@molstar/prism-viewer/spec';
import { FullPrismViewerSpec } from '@molstar/prism-viewer-app/full-spec';
import { optionsFromUrl } from '@molstar/prism-viewer-app/url';
import { MesoscaleExplorerExtensions } from './extensions.js';
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
  return {
    ...base,
    // A particle list with orientations opens as its spheres and its axes (Ludovic, 2026-10-22)
    plugin: {
      ...base.plugin,
      config: [...(base.plugin.config ?? []), [PluginConfig.Particles.ShowOrientations, true]],
    },
    extensions: [...(base.extensions ?? []), ...MesoscaleExplorerExtensions],
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
    agent: { ...(base.agent || {}), assistant: assistant() },
    finalize: (spec) =>
      withTomogramSlices(withMesoscaleLook(withoutRightClickFocus(base.finalize ? base.finalize(spec) : spec))),
  };
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
 * stage-tools extension), whose Focus item does what the right-click did; and without its Ctrl+click ones: Ctrl+click
 * picks a distance's points (_spec/ui.md, Measurements).
 */
const LeftClickFocusBindings = {
  clickCenterFocus: Binding(
    [Binding.Trigger(B.Flag.Primary, M.create()), Binding.Trigger(B.Flag.Trigger)],
    'Camera center and focus',
    'Click element using ${triggers}',
  ),
  clickCenterFocusSelectMode: Binding(
    [],
    'Camera center and focus (Selection Mode)',
    'Click element using ${triggers}',
  ),
  clickResetCameraOnEmpty: Binding(
    [Binding.Trigger(B.Flag.Primary, M.create()), Binding.Trigger(B.Flag.Trigger)],
    'Reset camera focus',
    'Click on nothing using ${triggers}',
  ),
  clickResetCameraOnEmptySelectMode: Binding(
    [],
    'Reset camera focus (Selection Mode)',
    'Click on nothing using ${triggers}',
  ),
};

/** The representation's focus without its Ctrl+click (and ⌘+click) add: those pick a distance's points */
const FocusBindingsWithoutAdd = {
  ...DefaultFocusLociBindings,
  clickFocusAdd: Binding([], 'Representation Focus Add', 'Click element using ${triggers}'),
};

function withoutRightClickFocus(spec: PluginSpec): PluginSpec {
  return {
    ...spec,
    behaviors: spec.behaviors.map((b) =>
      b.transformer === CameraFocusLoci
        ? PluginSpec.Behavior(CameraFocusLoci, { ...b.defaultParams, bindings: LeftClickFocusBindings })
        : b.transformer === RepresentationFocusLoci
          ? PluginSpec.Behavior(RepresentationFocusLoci, { ...b.defaultParams, bindings: FocusBindingsWithoutAdd })
          : b,
    ),
  };
}
