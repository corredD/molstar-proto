/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Choices, Select, type SelectOption, Show, Slider } from '@molstar/prism-ui';
import { mapState } from '@molstar/prism-ui/reactive/map-state';
import { derive } from '@molstar/prism-ui/reactive/state';
import { classes } from './_generated/controls.module.css.js';
import type { FitContrast } from './fit.js';
import type { GrowSettings, MesoscaleApi } from './operations.js';

// Fit to a volume in the Paint and Grow sections (density-fit; apps/prism-me/_spec/ui.md §4): the volume (Paint: Auto,
// the slice's under the pointer, None, or a volume of the scene; Grow: None or a volume), its Contrast, and Grow's
// Threshold. The settings are the mode's and the area's, no step.

const ContrastChoices = [
  { id: 'dark', label: 'Dark', title: 'The object darker than around it (a tomogram)' },
  { id: 'bright', label: 'Bright', title: 'The object brighter than around it (a map)' },
];

/** Paint's Fit to and Contrast */
export function PaintFit(props: { area: MesoscaleApi }) {
  const mode = props.area.paintMode;
  const settings = mode.settings.asReadonly;
  const volumes = props.area.fitVolumesState();
  /** The volume chosen while it is in the scene, else Auto's */
  const chosen = derive([settings, volumes], (s, list) =>
    s.fit === 'auto' || s.fit === '' || list.some((v) => v.ref === s.fit) ? s.fit : 'auto',
  );
  return (
    <div class={classes.tight}>
      <div class={classes.line}>
        <div
          class={classes.label}
          title="Each copy fitted to a volume: a shift and a turn within a third of its radius and 15° toward its density"
        >
          Fit to
        </div>
        <Show when={mapState(volumes, (list) => ({ list }))}>
          {({ list }) => (
            <Select
              size="sm"
              over
              aria-label="Paint fit to a volume"
              options={[
                ['auto', 'Auto: the slice under the pointer'],
                ['', 'None'],
                ...list.map((v): SelectOption => [v.ref, v.label]),
              ]}
              value={chosen}
              onChange={(fit) => mode.set({ fit })}
            />
          )}
        </Show>
      </div>
      <Show when={mapState(chosen, (f) => f !== '')}>
        {() => (
          <Choices
            label="Contrast"
            choices={ContrastChoices}
            active={mapState(settings, (s) => s.contrast)}
            onPick={(id) => mode.set({ contrast: id as FitContrast })}
          />
        )}
      </Show>
    </div>
  );
}

/**
 * Grow's Fit to (None or a volume of the scene), its Contrast and Threshold; `set`, the Grow section's (the live grow
 * made again)
 */
export function GrowFit(props: { area: MesoscaleApi; set: (patch: Partial<GrowSettings>, end?: boolean) => void }) {
  const settings = props.area.growSettings.asReadonly;
  const volumes = props.area.fitVolumesState();
  /** The volume chosen while it is in the scene */
  const chosen = derive([settings, volumes], (s, list) => (s.fit && list.some((v) => v.ref === s.fit) ? s.fit : ''));
  return (
    <div class={classes.tight}>
      <div class={classes.line}>
        <div
          class={classes.label}
          title="Each grown copy fitted to a volume (a sixth of its radius and 7.5°) and kept above the Threshold; Count counts those kept"
        >
          Fit to
        </div>
        <Show when={mapState(volumes, (list) => ({ list }))}>
          {({ list }) => (
            <Select
              size="sm"
              over
              aria-label="Grow fit to a volume"
              options={[['', 'None'], ...list.map((v): SelectOption => [v.ref, v.label])]}
              value={chosen}
              onChange={(fit) => props.set({ fit: fit || undefined })}
            />
          )}
        </Show>
      </div>
      <Show when={mapState(chosen, (f) => !!f)}>
        {() => (
          <div class={classes.tight}>
            <Choices
              label="Contrast"
              choices={ContrastChoices}
              active={mapState(settings, (s) => s.contrast)}
              onPick={(id) => props.set({ contrast: id as FitContrast })}
            />
            <div class={classes.line}>
              <div class={classes.label} title="A grown copy kept when its fit scores this × the source's at least">
                Threshold
              </div>
              <Slider
                aria-label="Grow fit threshold, × the source's score"
                value={mapState(settings, (s) => s.threshold)}
                min={0}
                max={1.5}
                step={0.05}
                onPreview={(threshold) => props.set({ threshold }, false)}
                onCommit={(threshold) => props.set({ threshold })}
              />
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}
