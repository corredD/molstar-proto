/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Button, Choices, Icon, Slider } from '@molstar/prism-ui';
import { mapState } from '@molstar/prism-ui/reactive/map-state';
import type { ReadonlyState } from '@molstar/prism-ui/reactive/readonly-state';
import { classes } from './_generated/controls.module.css.js';
import type { GraphicsInfo, GraphicsMode, MesoscaleApi } from './operations.js';

// The mesoscale controls, shown by the extension's Entities tab and by a host's panels (prism-me's properties): the
// graphics mode (every object's, or one object's) and the motion, as the representations have them, and the color
// file import. They act through the `mesoscale` area: a slider once released (one step). Prism's tokens and label
// column (controls.module.css).

const ModeChoices = [
  { id: 'ultra', label: 'Ultra' },
  { id: 'quality', label: 'Quality' },
  { id: 'balanced', label: 'Balanced' },
  { id: 'performance', label: 'Fast' },
];

/** The graphics mode of every object and the canvas's resolution */
export function GraphicsMode(props: { area: MesoscaleApi }) {
  const graphics = props.area.graphicsState();
  return (
    <Choices
      choices={ModeChoices}
      active={mapState(graphics, (g) => g?.mode ?? '')}
      onPick={(id) => void props.area.graphics({ mode: id as GraphicsMode })}
    />
  );
}

/**
 * One object's graphics (apps/prism-me/_spec/ui.md §4, Graphics & Motion): its quality, and its wiggle and tumble when
 * it moves (`motion`: a structure, a particle list; not a volume). Each acts on that object alone.
 */
export function ObjectGraphics(props: { area: MesoscaleApi; object: string; motion: boolean }) {
  const graphics = props.area.graphicsState(props.object);
  return (
    <div class={classes.stack}>
      <Choices
        label="Quality"
        choices={ModeChoices}
        active={mapState(graphics, (g) => g?.mode ?? '')}
        onPick={(id) => void props.area.graphics({ mode: id as GraphicsMode, object: props.object } as never)}
      />
      {props.motion ? <MotionRows area={props.area} graphics={graphics} of={{ object: props.object }} /> : null}
    </div>
  );
}

/** The particles' wiggle and tumble: one model's when it is given (a host's properties), else every list's */
export function Motion(props: { area: MesoscaleApi; particles?: string }) {
  const graphics = props.area.graphicsState(props.particles);
  return (
    <MotionRows area={props.area} graphics={graphics} of={props.particles ? { particles: props.particles } : {}} />
  );
}

/** The amplitude a motion switched on starts at */
const MotionOn = { wiggle: 1, tumble: 1 } as const;

/** Wiggle and tumble (the Mesoscale Explorer's procedural animation): each on or off, and its amplitude */
function MotionRows(props: {
  area: MesoscaleApi;
  graphics: ReadonlyState<GraphicsInfo | undefined>;
  of: { object?: string; particles?: string };
}) {
  const run = (key: 'wiggle' | 'tumble', v: number) => void props.area.motion({ [key]: v, ...props.of } as never);
  const row = (label: string, max: number, key: 'wiggle' | 'tumble') => {
    const value = mapState(props.graphics, (g) => g?.[key] ?? 0);
    return (
      <div class={classes.line}>
        <div class={classes.label}>
          <Button
            size="xs"
            variant="ghost"
            pressed={mapState(value, (v) => v > 0)}
            title={`${label}: on or off`}
            onClick={() => run(key, value.value > 0 ? 0 : MotionOn[key])}
          >
            {label}
          </Button>
        </div>
        <Slider
          aria-label={`${label} amplitude`}
          value={value}
          min={0}
          max={max}
          step={0.1}
          unit="Å"
          onCommit={(v) => run(key, v)}
        />
      </div>
    );
  };
  return (
    <div class={classes.tight}>
      {row('Wiggle', 5, 'wiggle')}
      {row('Tumble', 10, 'tumble')}
    </div>
  );
}

/**
 * Import colors…: a JSON color file picked, its colors put on the entities it names (`mesoscale.importColors`, one
 * step). The result, with the names not found, is the run's message (the status line), as for every person's run; a
 * file that cannot be read is said there too (`fileUnreadable`).
 */
export function ImportColors(props: { area: MesoscaleApi; particles?: string }) {
  const input = (
    <input
      type="file"
      accept=".json,application/json"
      hidden
      onChange={(e) => {
        const picked = e.currentTarget.files?.[0];
        e.currentTarget.value = '';
        if (!picked) return;
        picked.text().then(
          (json) => void props.area.importColors({ json, particles: props.particles ?? '' }),
          (err) => props.area.fileUnreadable(picked.name, err),
        );
      }}
    />
  ) as HTMLInputElement;
  return (
    <>
      {input}
      <Button
        size="sm"
        variant="ghost"
        icon={<Icon name="upload" />}
        title="Color the entities from a JSON file: the Mesoscale Explorer's, or entity names to colors"
        onClick={() => input.click()}
      >
        Import colors…
      </Button>
    </>
  );
}
